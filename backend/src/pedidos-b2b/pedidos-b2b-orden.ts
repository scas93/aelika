import { ConflictException } from '@nestjs/common';
import { EstadoEntrega, EstadoPago, EstadoPedido, Prisma, TipoOrden } from '../../generated/prisma/client';
import type { FacturaFields } from '../common/facturacion';
import { DIAS_EN_ORDEN, ItemsResueltos } from './pedidos-b2b-logica';
import { entregaAtrasada, estadoB2bVisible } from './pedidos-b2b-estados';

/**
 * Etapa 2 · capa de datos de un pedido B2B sobre la orden centralizada:
 *   Order (tipo B2B) + DetalleB2B (1:1) + OrderItem + Entrega (una por fecha con producto) + EntregaItem.
 *
 * Todo lo que escribe o lee un pedido B2B pasa por aquí para que el panel (TenantPrismaService) y el storefront
 * público (PrismaService crudo) no puedan divergir. Las funciones reciben un cliente de transacción de Prisma y el
 * tenantId explícito: la extensión tenant-scoped solo inyecta tenantId en la operación raíz, nunca en nested writes
 * (ver TenantPrismaService), así que cada fila se crea como su propia operación raíz.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

/** Fecha real de una entrega: lunes de la semana del pedido + offset del día (LUNES = 0 … DOMINGO = 6). */
export function fechaDeDia(semanaInicio: Date, dia: (typeof DIAS_EN_ORDEN)[number]): Date {
  return new Date(semanaInicio.getTime() + DIAS_EN_ORDEN.indexOf(dia) * DIA_MS);
}

/** Inversa: día de la semana de una entrega respecto de la semana del pedido (undefined si cae fuera de la semana). */
export function diaDeFecha(fecha: Date, semanaInicio: Date) {
  return DIAS_EN_ORDEN[Math.round((fecha.getTime() - semanaInicio.getTime()) / DIA_MS)];
}

export interface DatosOrdenB2b {
  tenantId: string;
  folio: string;
  clienteId: string;
  negocioNombre: string;
  contactoNombre: string;
  contactoTelefono: string;
  contactoCorreo: string;
  semanaInicio: Date;
  modoCobro: Prisma.DetalleB2BUncheckedCreateInput['modoCobro'];
  minimoPiezasAplicado: number;
  totalPiezas: number;
  subtotal: number;
  descuentoTotal: number;
  total: number;
  codigoDescuentoId: string | null;
  codigoDescuentoTexto: string | null;
  descuentoPorcentajeAplicado: number | null;
  factura?: FacturaFields;
}

/**
 * Crea el pedido B2B completo. ÚNICO lugar que fija el estado inicial de una orden B2B:
 *  · estadoPago PENDIENTE explícito — el default de Order.estadoPago es PAGADO (pensado para efectivo B2C) y un pedido
 *    B2B que naciera pagado se contaría como cobrado y no se podría editar.
 *  · metodoPago null — B2B no tiene método de pago.
 */
export async function crearOrdenB2b(tx: Prisma.TransactionClient, d: DatosOrdenB2b, items: ItemsResueltos) {
  const orden = await tx.order.create({
    data: {
      tenantId: d.tenantId,
      folio: d.folio,
      tipo: TipoOrden.B2B,
      clienteId: d.clienteId,
      clienteNombre: d.contactoNombre,
      clienteTelefono: d.contactoTelefono,
      clienteCorreo: d.contactoCorreo,
      metodoPago: null,
      estadoPago: EstadoPago.PENDIENTE,
      estadoPedido: EstadoPedido.PENDIENTE_CONFIRMACION,
      descuentoTotal: d.descuentoTotal,
      total: d.total,
      ...(d.factura ?? {}),
    } as Prisma.OrderUncheckedCreateInput,
  });

  await tx.detalleB2B.create({
    data: {
      tenantId: d.tenantId,
      orderId: orden.id,
      negocioNombre: d.negocioNombre,
      semanaInicio: d.semanaInicio,
      modoCobro: d.modoCobro,
      minimoPiezasAplicado: d.minimoPiezasAplicado,
      totalPiezas: d.totalPiezas,
      subtotal: d.subtotal,
      codigoDescuentoId: d.codigoDescuentoId,
      codigoDescuentoTexto: d.codigoDescuentoTexto,
      descuentoPorcentajeAplicado: d.descuentoPorcentajeAplicado,
    },
  });

  // Ítems en orden; entregas ordenadas por fecha; un EntregaItem por (entrega, ítem). Cantidad 0 nunca se escribe.
  const idsItem: string[] = [];
  for (const [i, item] of items.entries()) {
    const creado = await tx.orderItem.create({
      data: {
        tenantId: d.tenantId,
        orderId: orden.id,
        productId: item.productId,
        nombreProducto: item.nombreProducto,
        precioUnitario: item.precioUnitario,
        cantidad: item.cantidadTotal,
        orden: i,
      },
    });
    idsItem.push(creado.id);
  }

  const fechas = new Map<number, Date>();
  for (const item of items) for (const dia of item.distribucion) fechas.set(DIAS_EN_ORDEN.indexOf(dia.dia), fechaDeDia(d.semanaInicio, dia.dia));
  const idEntregaPorDia = new Map<number, string>();
  for (const idx of [...fechas.keys()].sort((a, b) => a - b)) {
    const entrega = await tx.entrega.create({ data: { tenantId: d.tenantId, orderId: orden.id, fecha: fechas.get(idx)! } });
    idEntregaPorDia.set(idx, entrega.id);
  }
  for (const [i, item] of items.entries()) {
    for (const dia of item.distribucion) {
      await tx.entregaItem.create({
        data: {
          tenantId: d.tenantId,
          entregaId: idEntregaPorDia.get(DIAS_EN_ORDEN.indexOf(dia.dia))!,
          orderItemId: idsItem[i],
          cantidad: dia.cantidad,
        },
      });
    }
  }
  return orden;
}

/**
 * Edición por diff (Etapa 2): actualiza, agrega o quita ítems y entregas puntuales conservando la identidad de lo que
 * sigue existiendo. Ítems se cruzan por productId; entregas por fecha (regla B2B: una entrega por fecha, sin restricción
 * en la base). `items` ya viene consolidado por producto (resolverItems).
 */
export async function sincronizarOrdenB2b(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
  semanaInicio: Date,
  items: ItemsResueltos,
) {
  const existentes = await tx.orderItem.findMany({
    where: { orderId },
    orderBy: [{ orden: 'asc' }, { id: 'asc' }],
    include: { entregaItems: true },
  });
  const entregas = await tx.entrega.findMany({ where: { orderId }, orderBy: { fecha: 'asc' }, include: { items: true } });

  const noPendiente = (e: { estado: EstadoEntrega; fecha: Date }): never => {
    throw new ConflictException(`La entrega del ${e.fecha.toISOString().slice(0, 10)} ya no está pendiente — no se puede modificar`);
  };

  // --- ítems
  const porProducto = new Map(existentes.filter((i) => i.productId).map((i) => [i.productId!, i]));
  const idsDeseados = new Set<string>();
  const idItemDe = new Map<string, string>(); // productId -> orderItem.id
  for (const [orden, item] of items.entries()) {
    const actual = porProducto.get(item.productId);
    if (actual) {
      await tx.orderItem.update({
        where: { id: actual.id },
        data: { nombreProducto: item.nombreProducto, precioUnitario: item.precioUnitario, cantidad: item.cantidadTotal, orden },
      });
      idsDeseados.add(actual.id);
      idItemDe.set(item.productId, actual.id);
    } else {
      const creado = await tx.orderItem.create({
        data: { tenantId, orderId, productId: item.productId, nombreProducto: item.nombreProducto, precioUnitario: item.precioUnitario, cantidad: item.cantidadTotal, orden },
      });
      idsDeseados.add(creado.id);
      idItemDe.set(item.productId, creado.id);
    }
  }

  // --- entregas deseadas: fecha(ms) -> (productId -> cantidad)
  const deseadas = new Map<number, Map<string, number>>();
  for (const item of items) {
    for (const dia of item.distribucion) {
      const ms = fechaDeDia(semanaInicio, dia.dia).getTime();
      const porItem = deseadas.get(ms) ?? new Map<string, number>();
      porItem.set(item.productId, (porItem.get(item.productId) ?? 0) + dia.cantidad);
      deseadas.set(ms, porItem);
    }
  }

  // quitar ítems que ya no están (su EntregaItem se va en cascada). Una entrega que ya no esté pendiente no se toca.
  for (const viejo of existentes) {
    if (idsDeseados.has(viejo.id)) continue;
    for (const ei of viejo.entregaItems) {
      const e = entregas.find((x) => x.id === ei.entregaId);
      if (e && e.estado !== EstadoEntrega.PENDIENTE) noPendiente(e);
    }
    await tx.orderItem.delete({ where: { id: viejo.id } });
  }

  // quitar entregas de fechas que ya no tienen nada; crear/actualizar las demás
  const entregaPorFecha = new Map<number, (typeof entregas)[number]>();
  for (const e of entregas) if (!entregaPorFecha.has(e.fecha.getTime())) entregaPorFecha.set(e.fecha.getTime(), e);

  for (const e of entregas) {
    if (deseadas.has(e.fecha.getTime()) && entregaPorFecha.get(e.fecha.getTime())?.id === e.id) continue;
    if (e.estado !== EstadoEntrega.PENDIENTE) noPendiente(e);
    await tx.entrega.delete({ where: { id: e.id } });
  }

  for (const ms of [...deseadas.keys()].sort((a, b) => a - b)) {
    const existente = entregaPorFecha.get(ms);
    const fecha = new Date(ms);
    let entregaId: string;
    if (existente) {
      entregaId = existente.id;
    } else {
      entregaId = (await tx.entrega.create({ data: { tenantId, orderId, fecha } })).id;
    }
    // Las filas de ítems ya quitados se fueron en cascada: solo quedan las de ítems que siguen en el pedido.
    const filas = (existente?.items ?? []).filter((f) => idsDeseados.has(f.orderItemId));
    const porProductoDeseado = deseadas.get(ms)!;
    const idsVigentes = new Set<string>();
    for (const [productId, cantidad] of porProductoDeseado) {
      const orderItemId = idItemDe.get(productId)!;
      idsVigentes.add(orderItemId);
      const fila = filas.find((f) => f.orderItemId === orderItemId);
      if (fila) {
        if (fila.cantidad !== cantidad) {
          if (existente!.estado !== EstadoEntrega.PENDIENTE) noPendiente(existente!);
          await tx.entregaItem.update({ where: { id: fila.id }, data: { cantidad } });
        }
      } else {
        if (existente && existente.estado !== EstadoEntrega.PENDIENTE) noPendiente(existente);
        await tx.entregaItem.create({ data: { tenantId, entregaId, orderItemId, cantidad } });
      }
    }
    for (const fila of filas) {
      if (idsVigentes.has(fila.orderItemId)) continue;
      if (existente!.estado !== EstadoEntrega.PENDIENTE) noPendiente(existente!);
      await tx.entregaItem.delete({ where: { id: fila.id } });
    }
  }
}

// ---------------------------------------------------------------------------
// Lectura: la orden B2B → la forma exacta de PedidoB2b que consume el frontend.
// ---------------------------------------------------------------------------

export const INCLUDE_PEDIDO = {
  detalleB2b: true,
  items: {
    orderBy: [{ orden: 'asc' as const }, { id: 'asc' as const }],
    include: { entregaItems: { include: { entrega: { select: { fecha: true } } } } },
  },
} satisfies Prisma.OrderInclude;

/** Igual que INCLUDE_PEDIDO + las entregas con su estado: solo para las respuestas del panel (el storefront público no las expone). */
export const INCLUDE_PEDIDO_ADMIN = {
  ...INCLUDE_PEDIDO,
  entregas: { orderBy: { fecha: 'asc' as const } },
} satisfies Prisma.OrderInclude;

export type OrdenB2bConDetalle = Prisma.OrderGetPayload<{ include: typeof INCLUDE_PEDIDO }> & {
  entregas?: Prisma.EntregaGetPayload<object>[];
};

/**
 * ÚNICO punto donde una orden B2B se convierte a la forma plana de PedidoB2b (el contrato de la API no cambió en la
 * Etapa 2). Lista explícita de campos — no "quitar los que sobran" — para que una columna nueva de Order/DetalleB2B
 * nunca se filtre a la respuesta. `distribucion` se deriva de las entregas (día = fecha − semanaInicio).
 */
export function aRespuestaPedidoB2b(orden: OrdenB2bConDetalle, opts: { conCodigo?: Prisma.PedidoB2bCodigoDescuentoGetPayload<object> | null } = {}) {
  const d = orden.detalleB2b!;
  const respuesta = {
    id: orden.id,
    tenantId: orden.tenantId,
    folio: orden.folio,
    negocioNombre: d.negocioNombre,
    contactoNombre: orden.clienteNombre,
    contactoTelefono: orden.clienteTelefono,
    contactoCorreo: orden.clienteCorreo,
    clienteId: orden.clienteId,
    semanaInicio: d.semanaInicio,
    modoCobro: d.modoCobro,
    // DESPACHADO (heredado, antes de migrar) se ve como COMPLETADO; "Cancelado" lo da `cancelado`, no este campo.
    estado: estadoB2bVisible(orden.estadoPedido),
    estadoPago: orden.estadoPago,
    cancelado: orden.cancelado,
    canceladoAt: orden.canceladoAt,
    minimoPiezasAplicado: d.minimoPiezasAplicado,
    totalPiezas: d.totalPiezas,
    codigoDescuentoId: d.codigoDescuentoId,
    codigoDescuentoTexto: d.codigoDescuentoTexto,
    descuentoPorcentajeAplicado: d.descuentoPorcentajeAplicado,
    subtotal: d.subtotal,
    descuentoTotal: orden.descuentoTotal,
    total: orden.total,
    requiereFactura: orden.requiereFactura,
    facturaRazonSocial: orden.facturaRazonSocial,
    facturaRfc: orden.facturaRfc,
    facturaRegimenFiscal: orden.facturaRegimenFiscal,
    facturaUsoCfdi: orden.facturaUsoCfdi,
    facturaCodigoPostal: orden.facturaCodigoPostal,
    facturaCorreo: orden.facturaCorreo,
    createdAt: orden.createdAt,
    updatedAt: orden.updatedAt,
    items: orden.items.map((item) => ({
      id: item.id,
      tenantId: item.tenantId,
      pedidoB2bId: item.orderId,
      productId: item.productId,
      nombreProducto: item.nombreProducto,
      precioUnitario: item.precioUnitario,
      cantidadTotal: item.cantidad,
      distribucion: item.entregaItems
        .map((ei) => ({ ei, dia: diaDeFecha(ei.entrega.fecha, d.semanaInicio) }))
        .sort((a, b) => DIAS_EN_ORDEN.indexOf(a.dia) - DIAS_EN_ORDEN.indexOf(b.dia))
        .map(({ ei, dia }) => ({ id: ei.id, tenantId: ei.tenantId, pedidoB2bItemId: ei.orderItemId, dia, cantidad: ei.cantidad })),
    })),
  };
  // Solo en las respuestas del panel (se cargó con INCLUDE_PEDIDO_ADMIN): cada entrega con su estado y si va atrasada.
  const conEntregas = orden.entregas
    ? {
        ...respuesta,
        entregas: orden.entregas.map((e) => ({
          id: e.id,
          fecha: e.fecha,
          dia: diaDeFecha(e.fecha, d.semanaInicio),
          estado: e.estado,
          cerradaAt: e.estado === EstadoEntrega.ENTREGADA || e.estado === EstadoEntrega.NO_RECOGIDA ? e.estadoCambiadoAt : null,
          atrasada: entregaAtrasada(e.estado, e.fecha),
        })),
      }
    : respuesta;
  return opts.conCodigo === undefined ? conEntregas : { ...conEntregas, codigoDescuento: opts.conCodigo };
}
