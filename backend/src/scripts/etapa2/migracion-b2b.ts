/**
 * Etapa 2 · núcleo de la migración de datos PedidoB2b → Order (+ DetalleB2B + Entrega + EntregaItem) y de su reversa.
 *
 * SQL por conjuntos (INSERT … SELECT), no fila por fila: conserva ids, folios y timestamps tal cual y es verificable.
 * Todas las funciones reciben un cliente de transacción de Prisma — el CLI (`../etapa2-b2b.ts`) decide si la
 * transacción se confirma o se revierte (ensayo). Los tests de caracterización importan estas mismas funciones.
 *
 * Reglas (acordadas en el plan de la Etapa 2):
 *  · Order.id = PedidoB2b.id; OrderItem.id = id del PedidoB2bItem; EntregaItem.id = id del PedidoB2bItemDia.
 *  · Idempotente: solo se migra lo que aún no tiene DetalleB2B.legacyPedidoB2bId.
 *  · Producto repetido en un pedido → UN solo OrderItem (cantidades sumadas, id del primero por orden físico).
 *  · Una Entrega por (pedido, fecha) con cantidad > 0; fecha = semanaInicio + offset del día. Nunca cantidad 0.
 *  · Estado inicial de la Entrega: ENTREGADA si el pedido está DESPACHADO; CANCELADA si está cancelado; si no, PENDIENTE.
 *  · Se aborta (rollback) si los datos legacy son inconsistentes o si cualquier verificación posterior no coincide.
 *  · PedidoB2b y sus tablas NO se borran ni se modifican.
 */
import type { Prisma } from '../../../generated/prisma/client';

export type Tx = Prisma.TransactionClient;
export interface Opciones {
  /** Limita el alcance a un tenant (uuid). */
  tenantId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const filtroTenant = (alias: string, o: Opciones) => {
  if (!o.tenantId) return '';
  if (!UUID.test(o.tenantId)) throw new Error(`tenantId inválido: ${o.tenantId}`);
  return ` AND ${alias}."tenantId" = '${o.tenantId}'`;
};

const rows = async <T = any>(tx: Tx, sql: string): Promise<T[]> => (await tx.$queryRawUnsafe(sql)) as T[];

/** CASE día de la semana → offset desde el lunes. `col` es una columna enum DiaSemana. */
const OFFSET_DIA = (col: string) =>
  `(CASE ${col}::text WHEN 'LUNES' THEN 0 WHEN 'MARTES' THEN 1 WHEN 'MIERCOLES' THEN 2 WHEN 'JUEVES' THEN 3 WHEN 'VIERNES' THEN 4 WHEN 'SABADO' THEN 5 WHEN 'DOMINGO' THEN 6 END)`;
const DIA_DE_OFFSET = (expr: string) =>
  `(CASE ${expr} WHEN 0 THEN 'LUNES' WHEN 1 THEN 'MARTES' WHEN 2 THEN 'MIERCOLES' WHEN 3 THEN 'JUEVES' WHEN 4 THEN 'VIERNES' WHEN 5 THEN 'SABADO' WHEN 6 THEN 'DOMINGO' END)::"DiaSemana"`;

// ---------------------------------------------------------------------------
// 1 · Planificación (solo lectura): lo que hay que revisar ANTES de --aplicar.
// ---------------------------------------------------------------------------

export interface Plan {
  tenants: any[];
  totales: { pedidosLegacy: number; migrados: number; pendientes: number; ordenesSinDetalle: number };
  /** Cada lista debe estar vacía para poder aplicar sin sorpresas (las informativas se marcan aparte). */
  hallazgos: {
    tenantsMixtos: any[];
    tenantsB2cConPedidosB2b: any[];
    productosRepetidos: any[];
    inconsistenciasCantidades: any[];
    pedidosSinItems: any[];
    diasEnCero: any[];
    clientesNoB2b: any[];
    foliosNoNumericos: any[];
    colisionesDeFolio: any[];
    semanaNoLunes: any[];
  };
  bloqueantes: string[];
}

export async function planificar(tx: Tx, o: Opciones = {}): Promise<Plan> {
  const t = filtroTenant('p', o);
  const pend = `NOT EXISTS (SELECT 1 FROM detalles_b2b d WHERE d."legacyPedidoB2bId" = p.id)`;

  const tenants = await rows(
    tx,
    `SELECT left(te.id,8) AS tenant, te.slug, te."tipoStorefront"::text AS tipo,
            count(p.id)::int AS pedidos_legacy,
            count(p.id) FILTER (WHERE ${pend})::int AS pendientes,
            (SELECT count(*)::int FROM orders ob WHERE ob."tenantId"=te.id AND ob.tipo='B2C') AS ordenes_b2c,
            (SELECT count(*)::int FROM orders ob WHERE ob."tenantId"=te.id AND ob.tipo='B2B') AS ordenes_b2b
       FROM tenants te JOIN pedidos_b2b p ON p."tenantId"=te.id ${t.replace('p."tenantId"', 'te.id')}
      GROUP BY te.id, te.slug, te."tipoStorefront" ORDER BY te.slug`,
  );

  const [tot] = await rows(
    tx,
    `SELECT (SELECT count(*)::int FROM pedidos_b2b p WHERE true ${t}) AS legacy,
            (SELECT count(*)::int FROM pedidos_b2b p WHERE EXISTS (SELECT 1 FROM detalles_b2b d WHERE d."legacyPedidoB2bId"=p.id) ${t}) AS migrados,
            (SELECT count(*)::int FROM pedidos_b2b p WHERE ${pend} ${t}) AS pendientes,
            (SELECT count(*)::int FROM pedidos_b2b p WHERE ${pend} AND EXISTS (SELECT 1 FROM orders ox WHERE ox.id=p.id) ${t}) AS ordenes_sin_detalle`,
  );

  const hallazgos = {
    tenantsMixtos: await rows(
      tx,
      `SELECT te.slug, te."tipoStorefront"::text AS tipo,
              (SELECT count(*)::int FROM orders ob WHERE ob."tenantId"=te.id AND ob.tipo='B2C') AS ordenes_b2c,
              count(p.id)::int AS pedidos_b2b
         FROM tenants te JOIN pedidos_b2b p ON p."tenantId"=te.id ${t.replace('p."tenantId"', 'te.id')}
        GROUP BY te.id, te.slug, te."tipoStorefront"
       HAVING (SELECT count(*) FROM orders ob WHERE ob."tenantId"=te.id AND ob.tipo='B2C') > 0 ORDER BY te.slug`,
    ),
    tenantsB2cConPedidosB2b: await rows(
      tx,
      `SELECT te.slug, count(p.id)::int AS pedidos_b2b
         FROM tenants te JOIN pedidos_b2b p ON p."tenantId"=te.id
        WHERE te."tipoStorefront"='RETAIL_B2C' ${t.replace('p."tenantId"', 'te.id')} GROUP BY te.slug ORDER BY te.slug`,
    ),
    productosRepetidos: await rows(
      tx,
      `SELECT left(p.id,8) AS pedido, p.folio, g.clave, g.n::int AS lineas
         FROM pedidos_b2b p JOIN (
           SELECT i."pedidoB2bId", COALESCE(i."productId", 'n:'||i."nombreProducto"||':'||i."precioUnitario"::text) AS clave, count(*) AS n
             FROM pedido_b2b_items i GROUP BY 1,2 HAVING count(*) > 1) g ON g."pedidoB2bId"=p.id
        WHERE ${pend} ${t} ORDER BY p.folio`,
    ),
    inconsistenciasCantidades: await rows(
      tx,
      `SELECT 'item' AS donde, left(p.id,8) AS pedido, p.folio, i."cantidadTotal"::int AS declarado,
              coalesce((SELECT sum(d.cantidad) FROM pedido_b2b_items_dia d WHERE d."pedidoB2bItemId"=i.id),0)::int AS suma_dias
         FROM pedidos_b2b p JOIN pedido_b2b_items i ON i."pedidoB2bId"=p.id
        WHERE ${pend} ${t} AND i."cantidadTotal" <> coalesce((SELECT sum(d.cantidad) FROM pedido_b2b_items_dia d WHERE d."pedidoB2bItemId"=i.id),0)
       UNION ALL
       SELECT 'pedido', left(p.id,8), p.folio, p."totalPiezas"::int,
              coalesce((SELECT sum(i."cantidadTotal") FROM pedido_b2b_items i WHERE i."pedidoB2bId"=p.id),0)::int
         FROM pedidos_b2b p
        WHERE ${pend} ${t} AND p."totalPiezas" <> coalesce((SELECT sum(i."cantidadTotal") FROM pedido_b2b_items i WHERE i."pedidoB2bId"=p.id),0)`,
    ),
    pedidosSinItems: await rows(
      tx,
      `SELECT left(p.id,8) AS pedido, p.folio FROM pedidos_b2b p
        WHERE ${pend} ${t} AND NOT EXISTS (SELECT 1 FROM pedido_b2b_items i WHERE i."pedidoB2bId"=p.id)`,
    ),
    diasEnCero: await rows(
      tx,
      `SELECT left(p.id,8) AS pedido, p.folio, d.dia::text AS dia FROM pedido_b2b_items_dia d
         JOIN pedido_b2b_items i ON i.id=d."pedidoB2bItemId" JOIN pedidos_b2b p ON p.id=i."pedidoB2bId"
        WHERE ${pend} ${t} AND d.cantidad <= 0`,
    ),
    clientesNoB2b: await rows(
      tx,
      `SELECT left(p.id,8) AS pedido, p.folio, c.canal::text AS canal FROM pedidos_b2b p JOIN clientes c ON c.id=p."clienteId"
        WHERE ${pend} ${t} AND c.canal <> 'B2B'`,
    ),
    foliosNoNumericos: await rows(
      tx,
      `SELECT left(p.id,8) AS pedido, p.folio FROM pedidos_b2b p WHERE ${pend} ${t} AND p.folio !~ '^[0-9]+$'`,
    ),
    colisionesDeFolio: await rows(
      tx,
      `SELECT left(p.id,8) AS pedido, p.folio, left(o.id,8) AS orden_existente FROM pedidos_b2b p
         JOIN orders o ON o."tenantId"=p."tenantId" AND o.tipo='B2B' AND o.folio=p.folio AND o.id <> p.id
        WHERE ${pend} ${t}`,
    ),
    semanaNoLunes: await rows(
      tx,
      `SELECT left(p.id,8) AS pedido, p.folio, p."semanaInicio"::text AS semana FROM pedidos_b2b p
        WHERE ${pend} ${t} AND extract(dow FROM p."semanaInicio") <> 1`,
    ),
  };

  const bloqueantes: string[] = [];
  if (hallazgos.inconsistenciasCantidades.length) bloqueantes.push('cantidades inconsistentes (cantidadTotal ≠ suma de días, o totalPiezas ≠ suma de ítems)');
  if (hallazgos.pedidosSinItems.length) bloqueantes.push('pedidos sin ítems');
  if (hallazgos.diasEnCero.length) bloqueantes.push('días con cantidad ≤ 0');
  if (hallazgos.clientesNoB2b.length) bloqueantes.push('pedidos cuyo Cliente no es canal B2B');
  if (hallazgos.foliosNoNumericos.length) bloqueantes.push('folios no numéricos (rompen la secuencia MAX(CAST(folio))');
  if (hallazgos.colisionesDeFolio.length) bloqueantes.push('colisión de folio con una orden B2B ya existente');
  if (tot.ordenes_sin_detalle > 0) bloqueantes.push('hay órdenes con el mismo id que un pedido pero sin DetalleB2B');

  return {
    tenants,
    totales: { pedidosLegacy: tot.legacy, migrados: tot.migrados, pendientes: tot.pendientes, ordenesSinDetalle: tot.ordenes_sin_detalle },
    hallazgos,
    bloqueantes,
  };
}

// ---------------------------------------------------------------------------
// 2 · Verificación legacy ↔ nuevo (hashes por pedido). Sirve a la migración, a la auditoría y a la reversa.
// ---------------------------------------------------------------------------

const COLS_PEDIDO_LEGACY = (p: string) =>
  [
    `${p}.folio`, `${p}."tenantId"`, `${p}."clienteId"`, `${p}."contactoNombre"`, `${p}."contactoTelefono"`, `${p}."contactoCorreo"`,
    `${p}."negocioNombre"`, `${p}."semanaInicio"`, `${p}."modoCobro"`, `${p}.estado`, `${p}."estadoPago"`, `${p}.cancelado`,
    `${p}."canceladoAt"`, `${p}."minimoPiezasAplicado"`, `${p}."totalPiezas"`, `${p}."codigoDescuentoId"`,
    `${p}."codigoDescuentoTexto"`, `${p}."descuentoPorcentajeAplicado"`, `${p}.subtotal`, `${p}."descuentoTotal"`, `${p}.total`,
    `${p}."requiereFactura"`, `${p}."facturaRazonSocial"`, `${p}."facturaRfc"`, `${p}."facturaRegimenFiscal"`, `${p}."facturaUsoCfdi"`,
    `${p}."facturaCodigoPostal"`, `${p}."facturaCorreo"`, `${p}."createdAt"`, `${p}."updatedAt"`,
  ];
const COLS_PEDIDO_NUEVO = (o: string, d: string) => [
  `${o}.folio`, `${o}."tenantId"`, `${o}."clienteId"`, `${o}."clienteNombre"`, `${o}."clienteTelefono"`, `${o}."clienteCorreo"`,
  `${d}."negocioNombre"`, `${d}."semanaInicio"`, `${d}."modoCobro"`, `${o}."estadoPedido"`, `${o}."estadoPago"`, `${o}.cancelado`,
  `${o}."canceladoAt"`, `${d}."minimoPiezasAplicado"`, `${d}."totalPiezas"`, `${d}."codigoDescuentoId"`,
  `${d}."codigoDescuentoTexto"`, `${d}."descuentoPorcentajeAplicado"`, `${d}.subtotal`, `${o}."descuentoTotal"`, `${o}.total`,
  `${o}."requiereFactura"`, `${o}."facturaRazonSocial"`, `${o}."facturaRfc"`, `${o}."facturaRegimenFiscal"`, `${o}."facturaUsoCfdi"`,
  `${o}."facturaCodigoPostal"`, `${o}."facturaCorreo"`, `${o}."createdAt"`, `${o}."updatedAt"`,
];
const hashCols = (cols: string[]) => `md5(${cols.map((c) => `coalesce(${c}::text,'~')`).join(` || '|' || `)})`;

/**
 * Compara, para el conjunto de pedidos que devuelve `setSql` (columna `id`), el grafo legacy contra el nuevo:
 * campos del pedido, ítems (consolidados por producto) y cantidades por (fecha, producto). Devuelve los que NO coinciden.
 */
export async function discrepancias(tx: Tx, setSql: string) {
  const claveItem = `COALESCE(i."productId", 'n:'||i."nombreProducto"||':'||i."precioUnitario"::text)`;
  const sql = `
  WITH s AS (${setSql}),
  leg AS (
    SELECT p.id,
      ${hashCols(COLS_PEDIDO_LEGACY('p'))} AS h_ped,
      (SELECT md5(coalesce(string_agg(g.t, ',' ORDER BY g.t), '')) FROM (
         SELECT concat_ws(':', coalesce(i."productId",'~'), i."nombreProducto", i."precioUnitario"::text, sum(i."cantidadTotal")::text) AS t
           FROM pedido_b2b_items i WHERE i."pedidoB2bId"=p.id
          GROUP BY ${claveItem}, i."productId", i."nombreProducto", i."precioUnitario") g) AS h_items,
      (SELECT md5(coalesce(string_agg(g.t, ',' ORDER BY g.t), '')) FROM (
         SELECT concat_ws(':', (p."semanaInicio" + ${OFFSET_DIA('d.dia')})::text, coalesce(i."productId",'~'), i."nombreProducto", sum(d.cantidad)::text) AS t
           FROM pedido_b2b_items_dia d JOIN pedido_b2b_items i ON i.id=d."pedidoB2bItemId"
          WHERE i."pedidoB2bId"=p.id AND d.cantidad > 0
          GROUP BY ${OFFSET_DIA('d.dia')}, i."productId", i."nombreProducto") g) AS h_dias
      FROM pedidos_b2b p WHERE p.id IN (SELECT id FROM s)),
  nue AS (
    SELECT o.id,
      ${hashCols(COLS_PEDIDO_NUEVO('o', 'd'))} AS h_ped,
      (SELECT md5(coalesce(string_agg(g.t, ',' ORDER BY g.t), '')) FROM (
         SELECT concat_ws(':', coalesce(oi."productId",'~'), oi."nombreProducto", oi."precioUnitario"::text, oi.cantidad::text) AS t
           FROM order_items oi WHERE oi."orderId"=o.id) g) AS h_items,
      (SELECT md5(coalesce(string_agg(g.t, ',' ORDER BY g.t), '')) FROM (
         SELECT concat_ws(':', e.fecha::text, coalesce(oi."productId",'~'), oi."nombreProducto", sum(ei.cantidad)::text) AS t
           FROM entrega_items ei JOIN entregas e ON e.id=ei."entregaId" JOIN order_items oi ON oi.id=ei."orderItemId"
          WHERE e."orderId"=o.id AND ei.cantidad > 0
          GROUP BY e.fecha, oi."productId", oi."nombreProducto") g) AS h_dias
      FROM orders o JOIN detalles_b2b d ON d."orderId"=o.id WHERE o.tipo='B2B' AND o.id IN (SELECT id FROM s))
  SELECT coalesce(leg.id, nue.id) AS id,
         (leg.id IS NULL) AS falta_legacy, (nue.id IS NULL) AS falta_nuevo,
         (leg.h_ped IS DISTINCT FROM nue.h_ped) AS dif_pedido,
         (leg.h_items IS DISTINCT FROM nue.h_items) AS dif_items,
         (leg.h_dias IS DISTINCT FROM nue.h_dias) AS dif_dias
    FROM leg FULL JOIN nue ON nue.id=leg.id
   WHERE leg.id IS NULL OR nue.id IS NULL OR leg.h_ped IS DISTINCT FROM nue.h_ped
      OR leg.h_items IS DISTINCT FROM nue.h_items OR leg.h_dias IS DISTINCT FROM nue.h_dias`;
  return rows<{ id: string; falta_legacy: boolean; falta_nuevo: boolean; dif_pedido: boolean; dif_items: boolean; dif_dias: boolean }>(tx, sql);
}

/** Agregados por tenant de ambos lados para el conjunto dado (para la tabla antes/después de la auditoría). */
export async function agregados(tx: Tx, setSql: string) {
  const legacy = await rows(
    tx,
    `WITH s AS (${setSql})
     SELECT te.slug,
            count(*)::int AS pedidos,
            count(*) FILTER (WHERE p.estado='PENDIENTE_CONFIRMACION')::int AS pendientes,
            count(*) FILTER (WHERE p.estado='CONFIRMADO_SURTIENDO')::int AS confirmados,
            count(*) FILTER (WHERE p.estado='DESPACHADO')::int AS despachados,
            count(*) FILTER (WHERE p."estadoPago"='PAGADO')::int AS pagados,
            count(*) FILTER (WHERE p.cancelado)::int AS cancelados,
            coalesce(sum(p.total),0)::text AS suma_total, coalesce(sum(p.subtotal),0)::text AS suma_subtotal,
            coalesce(sum(p."descuentoTotal"),0)::text AS suma_descuento, coalesce(sum(p."totalPiezas"),0)::int AS piezas,
            (SELECT count(*)::int FROM pedido_b2b_items i WHERE i."pedidoB2bId" IN (SELECT id FROM s) AND i."tenantId"=te.id) AS lineas_item,
            (SELECT coalesce(sum(d.cantidad),0)::int FROM pedido_b2b_items_dia d WHERE d."pedidoB2bItemId" IN (
               SELECT i.id FROM pedido_b2b_items i WHERE i."pedidoB2bId" IN (SELECT id FROM s)) AND d."tenantId"=te.id) AS piezas_en_dias,
            string_agg(p.folio, ',' ORDER BY p.folio::int) AS folios
       FROM pedidos_b2b p JOIN tenants te ON te.id=p."tenantId" WHERE p.id IN (SELECT id FROM s)
      GROUP BY te.id, te.slug ORDER BY te.slug`,
  );
  const nuevo = await rows(
    tx,
    `WITH s AS (${setSql})
     SELECT te.slug,
            count(*)::int AS pedidos,
            count(*) FILTER (WHERE o."estadoPedido"='PENDIENTE_CONFIRMACION')::int AS pendientes,
            count(*) FILTER (WHERE o."estadoPedido"='CONFIRMADO_SURTIENDO')::int AS confirmados,
            count(*) FILTER (WHERE o."estadoPedido"='DESPACHADO')::int AS despachados,
            count(*) FILTER (WHERE o."estadoPago"='PAGADO')::int AS pagados,
            count(*) FILTER (WHERE o.cancelado)::int AS cancelados,
            coalesce(sum(o.total),0)::text AS suma_total, coalesce(sum(d.subtotal),0)::text AS suma_subtotal,
            coalesce(sum(o."descuentoTotal"),0)::text AS suma_descuento, coalesce(sum(d."totalPiezas"),0)::int AS piezas,
            (SELECT count(*)::int FROM order_items oi WHERE oi."orderId" IN (SELECT id FROM s) AND oi."tenantId"=te.id) AS lineas_item,
            (SELECT coalesce(sum(ei.cantidad),0)::int FROM entrega_items ei JOIN entregas e ON e.id=ei."entregaId"
              WHERE e."orderId" IN (SELECT id FROM s) AND ei."tenantId"=te.id) AS piezas_en_dias,
            string_agg(o.folio, ',' ORDER BY CASE WHEN o.folio ~ '^[0-9]+$' THEN o.folio::int END) AS folios
       FROM orders o JOIN detalles_b2b d ON d."orderId"=o.id JOIN tenants te ON te.id=o."tenantId"
      WHERE o.tipo='B2B' AND o.id IN (SELECT id FROM s) GROUP BY te.id, te.slug ORDER BY te.slug`,
  );
  return { legacy, nuevo };
}

/** Piezas por (tenant, fecha) de ambos lados: la verificación "piezas por día antes y después". */
export async function piezasPorFecha(tx: Tx, setSql: string) {
  return rows<{ slug: string; fecha: string; legacy: number; nuevo: number }>(
    tx,
    `WITH s AS (${setSql}),
     l AS (SELECT p."tenantId", (p."semanaInicio" + ${OFFSET_DIA('d.dia')}) AS fecha, sum(d.cantidad)::int AS n
             FROM pedido_b2b_items_dia d JOIN pedido_b2b_items i ON i.id=d."pedidoB2bItemId" JOIN pedidos_b2b p ON p.id=i."pedidoB2bId"
            WHERE p.id IN (SELECT id FROM s) GROUP BY 1,2),
     n AS (SELECT e."tenantId", e.fecha, sum(ei.cantidad)::int AS n
             FROM entrega_items ei JOIN entregas e ON e.id=ei."entregaId"
            WHERE e."orderId" IN (SELECT id FROM s) GROUP BY 1,2)
     SELECT te.slug, coalesce(l.fecha, n.fecha)::text AS fecha, coalesce(l.n,0) AS legacy, coalesce(n.n,0) AS nuevo
       FROM l FULL JOIN n ON n."tenantId"=l."tenantId" AND n.fecha=l.fecha
       JOIN tenants te ON te.id = coalesce(l."tenantId", n."tenantId")
      ORDER BY te.slug, 2`,
  );
}

// ---------------------------------------------------------------------------
// 3 · Migración
// ---------------------------------------------------------------------------

export interface ResultadoMigracion {
  migrados: number;
  items: number;
  entregas: number;
  entregaItems: number;
  consolidados: number;
  verificacion: { discrepancias: number; piezasPorFechaDistintas: number };
}

export async function migrar(tx: Tx, o: Opciones = {}): Promise<ResultadoMigracion> {
  const t = filtroTenant('p', o);
  const plan = await planificar(tx, o);
  if (plan.bloqueantes.length) throw new Error(`Datos legacy no migrables: ${plan.bloqueantes.join('; ')}`);

  await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS _mig_pend, _mig_item_n, _mig_item_canon, _mig_dias, _mig_entrega`);
  await tx.$executeRawUnsafe(
    `CREATE TEMP TABLE _mig_pend ON COMMIT DROP AS
       SELECT p.id FROM pedidos_b2b p
        WHERE NOT EXISTS (SELECT 1 FROM detalles_b2b d WHERE d."legacyPedidoB2bId" = p.id) ${t}`,
  );
  const [{ n: pend }] = await rows<{ n: number }>(tx, `SELECT count(*)::int AS n FROM _mig_pend`);
  if (pend === 0) {
    return { migrados: 0, items: 0, entregas: 0, entregaItems: 0, consolidados: 0, verificacion: { discrepancias: 0, piezasPorFechaDistintas: 0 } };
  }

  // Order (metodoPago NULL a propósito: B2B no tiene método de pago; estadoPago/estadoPedido se copian explícitos).
  await tx.$executeRawUnsafe(
    `INSERT INTO orders (id,"tenantId",folio,"clienteNombre","clienteTelefono","clienteCorreo","clienteId","metodoPago","estadoPago","estadoPedido",
        tipo,cancelado,"canceladoAt","descuentoTotal",total,"requiereFactura","facturaRazonSocial","facturaRfc","facturaRegimenFiscal",
        "facturaUsoCfdi","facturaCodigoPostal","facturaCorreo","canalOrigen","createdAt","updatedAt")
     SELECT p.id,p."tenantId",p.folio,p."contactoNombre",p."contactoTelefono",p."contactoCorreo",p."clienteId",NULL,
        p."estadoPago"::text::"EstadoPago",p.estado::text::"EstadoPedido",'B2B'::"TipoOrden",p.cancelado,p."canceladoAt",p."descuentoTotal",
        p.total,p."requiereFactura",p."facturaRazonSocial",p."facturaRfc",p."facturaRegimenFiscal",p."facturaUsoCfdi",
        p."facturaCodigoPostal",p."facturaCorreo",'WEB'::"CanalOrigen",p."createdAt",p."updatedAt"
       FROM pedidos_b2b p JOIN _mig_pend m ON m.id=p.id`,
  );

  await tx.$executeRawUnsafe(
    `INSERT INTO detalles_b2b (id,"tenantId","orderId","legacyPedidoB2bId","negocioNombre","semanaInicio","modoCobro","minimoPiezasAplicado",
        "totalPiezas",subtotal,"codigoDescuentoId","codigoDescuentoTexto","descuentoPorcentajeAplicado")
     SELECT gen_random_uuid()::text,p."tenantId",p.id,p.id,p."negocioNombre",p."semanaInicio",p."modoCobro",p."minimoPiezasAplicado",
        p."totalPiezas",p.subtotal,p."codigoDescuentoId",p."codigoDescuentoTexto",p."descuentoPorcentajeAplicado"
       FROM pedidos_b2b p JOIN _mig_pend m ON m.id=p.id`,
  );

  // Ítems: se consolidan por producto dentro del pedido (clave = productId, o nombre+precio si el producto ya no existe).
  // El orden físico (ctid) es el orden en que hoy los devuelve la API, y define `orden` y qué id sobrevive.
  await tx.$executeRawUnsafe(
    `CREATE TEMP TABLE _mig_item_n ON COMMIT DROP AS
       SELECT i.id, i."tenantId", i."pedidoB2bId", i."productId", i."nombreProducto", i."precioUnitario",
              COALESCE(i."productId", 'n:'||i."nombreProducto"||':'||i."precioUnitario"::text) AS clave,
              row_number() OVER (PARTITION BY i."pedidoB2bId" ORDER BY i.ctid) AS rn
         FROM pedido_b2b_items i JOIN _mig_pend m ON m.id=i."pedidoB2bId"`,
  );
  await tx.$executeRawUnsafe(
    `CREATE TEMP TABLE _mig_item_canon ON COMMIT DROP AS
       SELECT DISTINCT ON ("pedidoB2bId", clave) id AS canon_id, "tenantId", "pedidoB2bId", "productId", "nombreProducto", "precioUnitario", clave, rn AS rn_canon
         FROM _mig_item_n ORDER BY "pedidoB2bId", clave, rn`,
  );
  // Cantidad por (ítem canónico, día): suma de los días de todas las líneas del grupo.
  await tx.$executeRawUnsafe(
    `CREATE TEMP TABLE _mig_dias ON COMMIT DROP AS
       SELECT c.canon_id, c."tenantId", c."pedidoB2bId", d.dia, (array_agg(d.id ORDER BY d.ctid))[1] AS dia_id, sum(d.cantidad)::int AS cantidad
         FROM pedido_b2b_items_dia d
         JOIN _mig_item_n n ON n.id=d."pedidoB2bItemId"
         JOIN _mig_item_canon c ON c."pedidoB2bId"=n."pedidoB2bId" AND c.clave=n.clave
        GROUP BY c.canon_id, c."tenantId", c."pedidoB2bId", d.dia HAVING sum(d.cantidad) > 0`,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO order_items (id,"tenantId","orderId","productId","nombreProducto","precioUnitario",cantidad,orden)
     SELECT c.canon_id,c."tenantId",c."pedidoB2bId",c."productId",c."nombreProducto",c."precioUnitario",
            coalesce((SELECT sum(x.cantidad) FROM _mig_dias x WHERE x.canon_id=c.canon_id),0),
            (row_number() OVER (PARTITION BY c."pedidoB2bId" ORDER BY c.rn_canon) - 1)::int
       FROM _mig_item_canon c`,
  );

  // Entregas: una por (pedido, fecha). El estado inicial depende del pedido (ver cabecera).
  await tx.$executeRawUnsafe(
    `CREATE TEMP TABLE _mig_entrega ON COMMIT DROP AS
       SELECT gen_random_uuid()::text AS id, x."pedidoB2bId", x."tenantId", x.fecha FROM (
         SELECT DISTINCT dd."pedidoB2bId", dd."tenantId", (p."semanaInicio" + ${OFFSET_DIA('dd.dia')}) AS fecha
           FROM _mig_dias dd JOIN pedidos_b2b p ON p.id=dd."pedidoB2bId") x`,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO entregas (id,"tenantId","orderId",fecha,estado,"estadoCambiadoAt","createdAt","updatedAt")
     SELECT e.id,e."tenantId",e."pedidoB2bId",e.fecha,
            (CASE WHEN p.cancelado THEN 'CANCELADA' WHEN p.estado::text='DESPACHADO' THEN 'ENTREGADA' ELSE 'PENDIENTE' END)::"EstadoEntrega",
            (CASE WHEN p.cancelado THEN coalesce(p."canceladoAt", p."updatedAt") WHEN p.estado::text='DESPACHADO' THEN p."updatedAt" END),
            p."createdAt",p."updatedAt"
       FROM _mig_entrega e JOIN pedidos_b2b p ON p.id=e."pedidoB2bId"`,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO entrega_items (id,"tenantId","entregaId","orderItemId",cantidad)
     SELECT dd.dia_id,dd."tenantId",e.id,dd.canon_id,dd.cantidad
       FROM _mig_dias dd JOIN pedidos_b2b p ON p.id=dd."pedidoB2bId"
       JOIN _mig_entrega e ON e."pedidoB2bId"=dd."pedidoB2bId" AND e.fecha = p."semanaInicio" + ${OFFSET_DIA('dd.dia')}`,
  );

  // Verificación (misma transacción: si algo no coincide, el llamador hace rollback).
  const set = `SELECT id FROM _mig_pend`;
  const dis = await discrepancias(tx, set);
  const pf = (await piezasPorFecha(tx, set)).filter((r) => r.legacy !== r.nuevo);
  if (dis.length || pf.length) {
    throw new Error(`Verificación fallida: ${dis.length} pedido(s) con diferencias (${dis.slice(0, 5).map((d) => d.id.slice(0, 8)).join(',')}), ${pf.length} fecha(s) con piezas distintas`);
  }
  const [r] = await rows<{ items: number; entregas: number; entrega_items: number; consolidados: number }>(
    tx,
    `SELECT (SELECT count(*)::int FROM _mig_item_canon) AS items,
            (SELECT count(*)::int FROM _mig_entrega) AS entregas,
            (SELECT count(*)::int FROM _mig_dias) AS entrega_items,
            ((SELECT count(*) FROM _mig_item_n) - (SELECT count(*) FROM _mig_item_canon))::int AS consolidados`,
  );
  return { migrados: pend, items: r.items, entregas: r.entregas, entregaItems: r.entrega_items, consolidados: r.consolidados, verificacion: { discrepancias: 0, piezasPorFechaDistintas: 0 } };
}

/** Conjunto "migrados" (con la marca legacy) para auditar. */
export const SET_MIGRADOS = (o: Opciones = {}) =>
  `SELECT d."legacyPedidoB2bId" AS id FROM detalles_b2b d WHERE d."legacyPedidoB2bId" IS NOT NULL ${filtroTenant('d', o)}`;
/** Todas las órdenes B2B (migradas y nacidas después). */
export const SET_ORDENES_B2B = (o: Opciones = {}) =>
  `SELECT o.id FROM orders o WHERE o.tipo='B2B' ${filtroTenant('o', o)}`;

// ---------------------------------------------------------------------------
// 4 · Reversa: reconstruye el grafo PedidoB2b desde las órdenes B2B y las elimina de Order.
// ---------------------------------------------------------------------------

export interface ResultadoReversa {
  ordenes: number;
  creadosEnLegacy: number;
  actualizadosEnLegacy: number;
  clientesRecalculados: number;
  eliminadas: number;
}

/** Filas de las tablas nuevas de las órdenes B2B como JSON: es el respaldo previo al borrado. */
export async function respaldoOrdenesB2b(tx: Tx, o: Opciones = {}) {
  const set = SET_ORDENES_B2B(o);
  const q = async (tabla: string, sql: string) => (await rows<{ j: unknown }>(tx, sql)).map((r) => ({ tabla, fila: r.j }));
  return [
    ...(await q('orders', `SELECT row_to_json(x) AS j FROM orders x WHERE x.id IN (${set})`)),
    ...(await q('detalles_b2b', `SELECT row_to_json(x) AS j FROM detalles_b2b x WHERE x."orderId" IN (${set})`)),
    ...(await q('order_items', `SELECT row_to_json(x) AS j FROM order_items x WHERE x."orderId" IN (${set})`)),
    ...(await q('entregas', `SELECT row_to_json(x) AS j FROM entregas x WHERE x."orderId" IN (${set})`)),
    ...(await q('entrega_items', `SELECT row_to_json(x) AS j FROM entrega_items x WHERE x."entregaId" IN (SELECT id FROM entregas WHERE "orderId" IN (${set}))`)),
  ];
}

export async function revertir(tx: Tx, o: Opciones = {}): Promise<ResultadoReversa> {
  const set = SET_ORDENES_B2B(o);
  const [{ n: ordenes }] = await rows<{ n: number }>(tx, `SELECT count(*)::int AS n FROM (${set}) s`);
  if (ordenes === 0) return { ordenes: 0, creadosEnLegacy: 0, actualizadosEnLegacy: 0, clientesRecalculados: 0, eliminadas: 0 };

  const [{ n: existentes }] = await rows<{ n: number }>(tx, `SELECT count(*)::int AS n FROM pedidos_b2b p WHERE p.id IN (${set})`);

  await tx.$executeRawUnsafe(
    `INSERT INTO pedidos_b2b (id,"tenantId",folio,"negocioNombre","contactoNombre","contactoTelefono","contactoCorreo","clienteId","semanaInicio",
        "modoCobro",estado,"estadoPago",cancelado,"canceladoAt","minimoPiezasAplicado","totalPiezas","codigoDescuentoId","codigoDescuentoTexto",
        "descuentoPorcentajeAplicado",subtotal,"descuentoTotal",total,"requiereFactura","facturaRazonSocial","facturaRfc","facturaRegimenFiscal",
        "facturaUsoCfdi","facturaCodigoPostal","facturaCorreo","createdAt","updatedAt")
     SELECT o.id,o."tenantId",o.folio,d."negocioNombre",o."clienteNombre",o."clienteTelefono",coalesce(o."clienteCorreo",''),o."clienteId",d."semanaInicio",
        d."modoCobro",o."estadoPedido"::text::"PedidoB2bEstado",o."estadoPago"::text::"PedidoB2bEstadoPago",o.cancelado,o."canceladoAt",
        d."minimoPiezasAplicado",d."totalPiezas",d."codigoDescuentoId",d."codigoDescuentoTexto",d."descuentoPorcentajeAplicado",d.subtotal,
        o."descuentoTotal",o.total,o."requiereFactura",o."facturaRazonSocial",o."facturaRfc",o."facturaRegimenFiscal",o."facturaUsoCfdi",
        o."facturaCodigoPostal",o."facturaCorreo",o."createdAt",o."updatedAt"
       FROM orders o JOIN detalles_b2b d ON d."orderId"=o.id WHERE o.id IN (${set})
     ON CONFLICT (id) DO UPDATE SET
        folio=EXCLUDED.folio,"negocioNombre"=EXCLUDED."negocioNombre","contactoNombre"=EXCLUDED."contactoNombre",
        "contactoTelefono"=EXCLUDED."contactoTelefono","contactoCorreo"=EXCLUDED."contactoCorreo","clienteId"=EXCLUDED."clienteId",
        "semanaInicio"=EXCLUDED."semanaInicio","modoCobro"=EXCLUDED."modoCobro",estado=EXCLUDED.estado,"estadoPago"=EXCLUDED."estadoPago",
        cancelado=EXCLUDED.cancelado,"canceladoAt"=EXCLUDED."canceladoAt","minimoPiezasAplicado"=EXCLUDED."minimoPiezasAplicado",
        "totalPiezas"=EXCLUDED."totalPiezas","codigoDescuentoId"=EXCLUDED."codigoDescuentoId","codigoDescuentoTexto"=EXCLUDED."codigoDescuentoTexto",
        "descuentoPorcentajeAplicado"=EXCLUDED."descuentoPorcentajeAplicado",subtotal=EXCLUDED.subtotal,"descuentoTotal"=EXCLUDED."descuentoTotal",
        total=EXCLUDED.total,"requiereFactura"=EXCLUDED."requiereFactura","facturaRazonSocial"=EXCLUDED."facturaRazonSocial",
        "facturaRfc"=EXCLUDED."facturaRfc","facturaRegimenFiscal"=EXCLUDED."facturaRegimenFiscal","facturaUsoCfdi"=EXCLUDED."facturaUsoCfdi",
        "facturaCodigoPostal"=EXCLUDED."facturaCodigoPostal","facturaCorreo"=EXCLUDED."facturaCorreo","updatedAt"=EXCLUDED."updatedAt"`,
  );

  // Ítems y días: se reconstruyen completos (ids conservados: OrderItem.id / EntregaItem.id).
  await tx.$executeRawUnsafe(`DELETE FROM pedido_b2b_items WHERE "pedidoB2bId" IN (${set})`);
  await tx.$executeRawUnsafe(
    `INSERT INTO pedido_b2b_items (id,"tenantId","pedidoB2bId","productId","nombreProducto","precioUnitario","cantidadTotal")
     SELECT oi.id,oi."tenantId",oi."orderId",oi."productId",oi."nombreProducto",oi."precioUnitario",oi.cantidad
       FROM order_items oi WHERE oi."orderId" IN (${set})`,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO pedido_b2b_items_dia (id,"tenantId","pedidoB2bItemId",dia,cantidad)
     SELECT (array_agg(ei.id ORDER BY ei.id))[1], ei."tenantId", ei."orderItemId",
            ${DIA_DE_OFFSET('(e.fecha - d."semanaInicio")')}, sum(ei.cantidad)::int
       FROM entrega_items ei JOIN entregas e ON e.id=ei."entregaId" JOIN detalles_b2b d ON d."orderId"=e."orderId"
      WHERE e."orderId" IN (${set}) AND ei.cantidad > 0
      GROUP BY ei."tenantId", ei."orderItemId", (e.fecha - d."semanaInicio")`,
  );

  // Contadores de los Clientes B2B, con la fórmula del código ANTERIOR (PedidoB2b no cancelado).
  const clientes = await rows<{ id: string }>(tx, `SELECT DISTINCT o."clienteId" AS id FROM orders o WHERE o.id IN (${set})`);
  await tx.$executeRawUnsafe(
    `UPDATE clientes c SET
        "totalPedidos" = coalesce(a.n, 0),
        "primerPedidoAt" = coalesce(a.primero, c."createdAt"),
        "ultimoPedidoAt" = coalesce(a.ultimo, c."createdAt")
       FROM (SELECT cc.id, count(p.id) AS n, min(p."createdAt") AS primero, max(p."createdAt") AS ultimo
               FROM clientes cc LEFT JOIN pedidos_b2b p ON p."clienteId"=cc.id AND p.cancelado = false
              WHERE cc.id IN (SELECT DISTINCT o."clienteId" FROM orders o WHERE o.id IN (${set})) GROUP BY cc.id) a
      WHERE c.id=a.id`,
  );

  // Antes de borrar: el grafo legacy reconstruido tiene que coincidir con el de las órdenes.
  const dis = await discrepancias(tx, set);
  if (dis.length) throw new Error(`Reversa: ${dis.length} pedido(s) reconstruido(s) no coinciden (${dis.slice(0, 5).map((d) => d.id.slice(0, 8)).join(',')})`);

  const eliminadas = await tx.$executeRawUnsafe(`DELETE FROM orders WHERE id IN (${set})`);
  return { ordenes, creadosEnLegacy: ordenes - existentes, actualizadosEnLegacy: existentes, clientesRecalculados: clientes.length, eliminadas: Number(eliminadas) };
}
