import { readFileSync } from 'fs';
import { join } from 'path';
import { usarSuite } from './helpers';
import { capturar, cargarLegacy, DoradosArchivo, etiquetasDorado } from './etapa2-dorados';
import { apiRol } from './b2b-helpers';
import {
  agregados,
  discrepancias,
  migrar,
  piezasPorFecha,
  planificar,
  respaldoOrdenesB2b,
  revertir,
  SET_MIGRADOS,
  SET_ORDENES_B2B,
} from '../../src/scripts/etapa2/migracion-b2b';

// Etapa 2 · migración de datos PedidoB2b → Order. Parte de las filas legacy REALES del volcado de los dorados
// (generado con el código previo a la Etapa 2), las migra con el mismo núcleo que usa el script y comprueba:
// ids/folios/fechas/totales conservados, estados de entrega, verificación interna, idempotencia, consolidación,
// bloqueantes, y la reversa ida y vuelta. Además compara la salida HTTP con los MISMOS dorados.
const dorados: DoradosArchivo = JSON.parse(readFileSync(join(__dirname, '__dorados__', 'etapa2-b2b.json'), 'utf8'));

describe('Etapa 2 · migración de datos B2B', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const prisma = () => s.h.prisma;
  const tx = <T>(fn: (t: any) => Promise<T>) => prisma().$transaction((t) => fn(t));
  const filas = async (sql: string) => (await prisma().$queryRawUnsafe(sql)) as any[];

  it('plan: sin bloqueantes, todo pendiente, sin tenants mixtos', async () => {
    await cargarLegacy(prisma(), s, dorados);
    const plan = await tx((t) => planificar(t));
    expect(plan.bloqueantes).toStrictEqual([]);
    expect(plan.totales).toStrictEqual({ pedidosLegacy: 6, migrados: 0, pendientes: 6, ordenesSinDetalle: 0 });
    expect(plan.hallazgos.tenantsMixtos).toStrictEqual([]);
    expect(plan.hallazgos.productosRepetidos).toStrictEqual([]);
  });

  describe('migración del escenario p1..p6', () => {
    beforeEach(async () => {
      await cargarLegacy(prisma(), s, dorados);
    });

    it('migra todo, conserva ids/folios/totales y deja la verificación en limpio', async () => {
      const r = await tx((t) => migrar(t));
      expect(r).toMatchObject({ migrados: 6, items: 7, entregas: 8, entregaItems: 8, consolidados: 0 });

      // ids estables: Order.id = PedidoB2b.id, OrderItem.id = PedidoB2bItem.id, EntregaItem.id = PedidoB2bItemDia.id
      const leg = dorados.legacy;
      const ids = (a: any[]) => a.map((x) => x.id).sort();
      expect(ids(await filas(`SELECT id FROM orders WHERE tipo='B2B'`))).toStrictEqual(ids(leg.pedidos));
      expect(ids(await filas(`SELECT id FROM order_items`))).toStrictEqual(ids(leg.items));
      expect(ids(await filas(`SELECT id FROM entrega_items`))).toStrictEqual(ids(leg.itemsDia));

      // Mapeo de campos y estados
      const ordenes = await filas(
        `SELECT o.folio, o."estadoPedido"::text AS estado, o."estadoPago"::text AS pago, o.cancelado, o."metodoPago", o.tipo::text AS tipo,
                o.total::text AS total, o."canalOrigen"::text AS canal, d."legacyPedidoB2bId" = o.id AS legacy_ok
           FROM orders o JOIN detalles_b2b d ON d."orderId"=o.id ORDER BY o.folio::int`,
      );
      expect(ordenes).toStrictEqual([
        { folio: '1', estado: 'DESPACHADO', pago: 'PAGADO', cancelado: false, metodoPago: null, tipo: 'B2B', total: '540.00', canal: 'WEB', legacy_ok: true },
        { folio: '2', estado: 'CONFIRMADO_SURTIENDO', pago: 'PENDIENTE', cancelado: false, metodoPago: null, tipo: 'B2B', total: '540.00', canal: 'WEB', legacy_ok: true },
        { folio: '3', estado: 'PENDIENTE_CONFIRMACION', pago: 'PENDIENTE', cancelado: false, metodoPago: null, tipo: 'B2B', total: '305.00', canal: 'WEB', legacy_ok: true },
        { folio: '4', estado: 'PENDIENTE_CONFIRMACION', pago: 'PENDIENTE', cancelado: false, metodoPago: null, tipo: 'B2B', total: '542.25', canal: 'WEB', legacy_ok: true },
        { folio: '5', estado: 'PENDIENTE_CONFIRMACION', pago: 'PENDIENTE', cancelado: true, metodoPago: null, tipo: 'B2B', total: '450.00', canal: 'WEB', legacy_ok: true },
        { folio: '6', estado: 'CONFIRMADO_SURTIENDO', pago: 'PAGADO', cancelado: false, metodoPago: null, tipo: 'B2B', total: '900.00', canal: 'WEB', legacy_ok: true },
      ]);

      // Entregas: ENTREGADA (despachado), CANCELADA (cancelado), PENDIENTE (el resto); fecha real = semana + día
      const entregas = await filas(
        `SELECT o.folio, e.fecha::text AS fecha, e.estado::text AS estado, e.hora, e.destino, e.nota, e."estadoCambiadoPorId"
           FROM entregas e JOIN orders o ON o.id=e."orderId" ORDER BY o.folio::int, e.fecha`,
      );
      expect(entregas.map((e) => `${e.folio}|${e.fecha}|${e.estado}`)).toStrictEqual([
        '1|2026-09-14|ENTREGADA',
        '2|2026-09-28|PENDIENTE',
        '2|2026-09-30|PENDIENTE',
        '3|2026-09-30|PENDIENTE',
        '4|2026-10-05|PENDIENTE',
        '4|2026-10-08|PENDIENTE',
        '5|2026-10-05|CANCELADA',
        '6|2026-10-13|PENDIENTE',
      ]);
      expect(entregas.every((e) => e.hora === null && e.destino === null && e.nota === null && e.estadoCambiadoPorId === null)).toBe(true);

      // `orden` conserva la posición original de los ítems; el detalle B2C NO se crea
      const orden = await filas(`SELECT o.folio, oi."nombreProducto" AS n, oi.orden FROM order_items oi JOIN orders o ON o.id=oi."orderId" WHERE o.folio='4' ORDER BY oi.orden`);
      expect(orden).toStrictEqual([{ folio: '4', n: 'Café americano', orden: 0 }, { folio: '4', n: 'Concha', orden: 1 }]);
      expect(await filas(`SELECT 1 FROM detalles_b2c`)).toHaveLength(0);

      // verificación independiente: hashes por pedido y piezas por fecha
      expect(await tx((t) => discrepancias(t, SET_MIGRADOS()))).toStrictEqual([]);
      expect((await tx((t) => piezasPorFecha(t, SET_MIGRADOS()))).filter((x) => x.legacy !== x.nuevo)).toStrictEqual([]);
      const ag = await tx((t) => agregados(t, SET_MIGRADOS()));
      expect(ag.nuevo).toStrictEqual(ag.legacy); // mismos conteos, totales, piezas, folios
    });

    it('es idempotente: una segunda corrida no migra nada ni duplica', async () => {
      await tx((t) => migrar(t));
      const antes = await filas(`SELECT (SELECT count(*) FROM orders)::int o, (SELECT count(*) FROM order_items)::int i, (SELECT count(*) FROM entregas)::int e, (SELECT count(*) FROM entrega_items)::int ei`);
      const r2 = await tx((t) => migrar(t));
      expect(r2.migrados).toBe(0);
      expect(await filas(`SELECT (SELECT count(*) FROM orders)::int o, (SELECT count(*) FROM order_items)::int i, (SELECT count(*) FROM entregas)::int e, (SELECT count(*) FROM entrega_items)::int ei`)).toStrictEqual(antes);
    });

    it('no modifica las tablas legacy ni los contadores de Cliente', async () => {
      const lectura = async () => ({
        pedidos: await filas(`SELECT * FROM pedidos_b2b ORDER BY id`),
        items: await filas(`SELECT * FROM pedido_b2b_items ORDER BY id`),
        dias: await filas(`SELECT * FROM pedido_b2b_items_dia ORDER BY id`),
        clientes: await filas(`SELECT id, "totalPedidos", "primerPedidoAt", "ultimoPedidoAt", "updatedAt" FROM clientes ORDER BY id`),
      });
      const antes = await lectura();
      await tx((t) => migrar(t));
      expect(await lectura()).toStrictEqual(antes);
    });

    it('detecta una alteración posterior (la verificación no es decorativa)', async () => {
      await tx((t) => migrar(t));
      await prisma().$executeRawUnsafe(`UPDATE orders SET total = total + 1 WHERE tipo='B2B' AND folio='3'`);
      await prisma().$executeRawUnsafe(`UPDATE entrega_items SET cantidad = cantidad + 1 WHERE id = (SELECT ei.id FROM entrega_items ei JOIN entregas e ON e.id=ei."entregaId" JOIN orders o ON o.id=e."orderId" WHERE o.folio='1' LIMIT 1)`);
      const dis = await tx((t) => discrepancias(t, SET_MIGRADOS()));
      expect(dis.length).toBe(2);
      expect(dis.some((d) => d.dif_pedido)).toBe(true);
      expect(dis.some((d) => d.dif_dias)).toBe(true);
    });

    it('las respuestas HTTP tras migrar son idénticas a los dorados', async () => {
      await tx((t) => migrar(t));
      const e = { ids: dorados.ids as any, codigoId: dorados.codigoId };
      const consultas = await capturar(s, e);
      expect(Object.keys(consultas)).toStrictEqual(Object.keys(dorados.consultas));
      for (const nombre of Object.keys(dorados.consultas)) {
        expect({ nombre, ...(consultas[nombre] as object) }).toStrictEqual({ nombre, ...dorados.consultas[nombre] });
      }
      void etiquetasDorado;
      void apiRol;
    });

    it('reversa ida y vuelta: las tablas legacy y los contadores quedan como antes y las órdenes B2B desaparecen', async () => {
      const leg = async () => ({
        pedidos: await filas(`SELECT * FROM pedidos_b2b ORDER BY id`),
        items: await filas(`SELECT * FROM pedido_b2b_items ORDER BY id`),
        dias: await filas(`SELECT * FROM pedido_b2b_items_dia ORDER BY id`),
        clientes: await filas(`SELECT id, "totalPedidos", "primerPedidoAt", "ultimoPedidoAt" FROM clientes ORDER BY id`),
      });
      const antes = await leg();
      await tx((t) => migrar(t));
      // actividad posterior al corte: un pedido nuevo nacido solo en Order (sin fila legacy), con su Cliente
      const cliente = await prisma().cliente.findFirstOrThrow({ where: { canal: 'B2B' } });
      const nuevo = await prisma().order.create({
        data: {
          tenantId: s.base.tenant.id, folio: '7', tipo: 'B2B', clienteNombre: 'Nuevo', clienteTelefono: '5500000077', clienteCorreo: 'n@n.test',
          clienteId: cliente.id, metodoPago: null, estadoPago: 'PENDIENTE', total: '90', descuentoTotal: '0',
          detalleB2b: { create: { tenantId: s.base.tenant.id, negocioNombre: 'Nuevo SA', semanaInicio: new Date('2026-10-19T00:00:00.000Z'), modoCobro: 'AL_FINAL', minimoPiezasAplicado: 10, totalPiezas: 3, subtotal: '90' } },
          items: { create: { tenantId: s.base.tenant.id, productId: s.base.productoA.id, nombreProducto: 'Café americano', precioUnitario: '45', cantidad: 2, orden: 0 } },
        },
        include: { items: true },
      });
      const entrega = await prisma().entrega.create({ data: { tenantId: s.base.tenant.id, orderId: nuevo.id, fecha: new Date('2026-10-21T00:00:00.000Z') } });
      await prisma().entregaItem.create({ data: { tenantId: s.base.tenant.id, entregaId: entrega.id, orderItemId: nuevo.items[0].id, cantidad: 2 } });

      // ensayo: no escribe
      const respaldo = await tx((t) => respaldoOrdenesB2b(t));
      expect(respaldo.filter((r) => r.tabla === 'orders')).toHaveLength(7);
      const ensayo = await prisma().$transaction(async (t) => {
        await revertir(t);
        throw new Error('rollback');
      }).catch((e) => e.message);
      expect(ensayo).toBe('rollback');
      expect(await filas(`SELECT count(*)::int n FROM orders WHERE tipo='B2B'`)).toStrictEqual([{ n: 7 }]);

      const r = await tx((t) => revertir(t));
      expect(r).toMatchObject({ ordenes: 7, creadosEnLegacy: 1, actualizadosEnLegacy: 6, eliminadas: 7 });
      expect(await filas(`SELECT count(*)::int n FROM orders WHERE tipo='B2B'`)).toStrictEqual([{ n: 0 }]);
      expect(await filas(`SELECT count(*)::int n FROM entregas`)).toStrictEqual([{ n: 0 }]);

      const despues = await leg();
      // los 6 pedidos originales vuelven idénticos; el nuevo quedó reconstruido como pedido legacy
      expect(despues.pedidos.filter((p) => antes.pedidos.some((a) => a.id === p.id))).toStrictEqual(antes.pedidos);
      expect(despues.pedidos).toHaveLength(7);
      const nuevoLeg = despues.pedidos.find((p) => p.id === nuevo.id);
      expect(nuevoLeg).toMatchObject({ folio: '7', negocioNombre: 'Nuevo SA', totalPiezas: 3 });
      expect(despues.items.filter((i) => antes.items.some((a) => a.id === i.id)).sort((a, b) => a.id.localeCompare(b.id))).toStrictEqual(antes.items);
      expect(despues.dias.filter((i) => antes.dias.some((a) => a.id === i.id))).toStrictEqual(antes.dias);
      expect(despues.dias.find((d) => d.pedidoB2bItemId === nuevo.items[0].id)).toMatchObject({ dia: 'MIERCOLES', cantidad: 2 });
      // el cliente del pedido nuevo ahora cuenta 1 pedido más en el modelo anterior
      const cl = despues.clientes.find((c) => c.id === cliente.id);
      const cl0 = antes.clientes.find((c) => c.id === cliente.id);
      expect(cl.totalPedidos).toBe(cl0.totalPedidos + 1);
    });
  });

  describe('casos raros', () => {
    it('producto repetido en un pedido → un solo OrderItem con las cantidades sumadas (y se reporta como consolidado)', async () => {
      const v = await cargarLegacy(prisma(), s, dorados);
      const p = v.pedidos[0];
      const itemA = v.items.find((i) => i.pedidoB2bId === p.id)!;
      // segunda línea del mismo producto en el mismo pedido, otro día
      const dup = await prisma().pedidoB2bItem.create({
        data: { tenantId: itemA.tenantId, pedidoB2bId: p.id, productId: itemA.productId, nombreProducto: itemA.nombreProducto, precioUnitario: itemA.precioUnitario, cantidadTotal: 3 },
      });
      await prisma().pedidoB2bItemDia.create({ data: { tenantId: itemA.tenantId, pedidoB2bItemId: dup.id, dia: 'MARTES', cantidad: 3 } });
      await prisma().pedidoB2b.update({ where: { id: p.id }, data: { totalPiezas: p.totalPiezas + 3 } });

      const plan = await tx((t) => planificar(t));
      expect(plan.hallazgos.productosRepetidos).toHaveLength(1);
      const r = await tx((t) => migrar(t));
      expect(r.consolidados).toBe(1);
      const items = await filas(`SELECT id, cantidad FROM order_items WHERE "orderId"='${p.id}'`);
      expect(items).toStrictEqual([{ id: itemA.id, cantidad: itemA.cantidadTotal + 3 }]); // sobrevive el id del primero
      expect(await tx((t) => discrepancias(t, SET_MIGRADOS()))).toStrictEqual([]);
    });

    it('datos inconsistentes → no migra nada (rollback) y lo reporta como bloqueante', async () => {
      const v = await cargarLegacy(prisma(), s, dorados);
      await prisma().pedidoB2bItem.update({ where: { id: v.items[0].id }, data: { cantidadTotal: 99 } });
      const plan = await tx((t) => planificar(t));
      expect(plan.bloqueantes.join(' ')).toMatch(/inconsistentes/);
      await expect(tx((t) => migrar(t))).rejects.toThrow(/no migrables/);
      expect(await filas(`SELECT count(*)::int n FROM orders`)).toStrictEqual([{ n: 0 }]);
    });

    it('colisión de folio con una orden B2B ya existente → bloqueante', async () => {
      const v = await cargarLegacy(prisma(), s, dorados);
      const cliente = v.clientes[0];
      await prisma().order.create({
        data: { tenantId: s.base.tenant.id, folio: v.pedidos[0].folio, tipo: 'B2B', clienteNombre: 'X', clienteTelefono: '5500000001', clienteId: cliente.id, metodoPago: null, estadoPago: 'PENDIENTE', total: '1' },
      });
      const plan = await tx((t) => planificar(t));
      expect(plan.bloqueantes.join(' ')).toMatch(/colisión de folio/);
    });

    it('la CHECK de la base impide una orden B2C sin método de pago', async () => {
      const v = await cargarLegacy(prisma(), s, dorados);
      await expect(
        prisma().order.create({
          data: { tenantId: s.base.tenant.id, folio: '99', tipo: 'B2C', clienteNombre: 'X', clienteTelefono: '5500000001', clienteId: v.clientes[0].id, metodoPago: null, total: '1' },
        }),
      ).rejects.toThrow();
    });

    it('el mismo folio puede existir como B2C y como B2B en el mismo tenant', async () => {
      const v = await cargarLegacy(prisma(), s, dorados);
      await tx((t) => migrar(t));
      const cliente = await prisma().cliente.create({
        data: { tenantId: s.base.tenant.id, canal: 'B2C', telefono: '5511112222', nombre: 'Ana', primerPedidoAt: new Date(), ultimoPedidoAt: new Date() },
      });
      await prisma().order.create({
        data: { tenantId: s.base.tenant.id, folio: v.pedidos[0].folio, tipo: 'B2C', clienteNombre: 'Ana', clienteTelefono: '5511112222', clienteId: cliente.id, total: '45' },
      });
      expect(await filas(`SELECT count(*)::int n FROM orders WHERE folio='${v.pedidos[0].folio}'`)).toStrictEqual([{ n: 2 }]);
      void SET_ORDENES_B2B;
    });
  });
});
