import {
  EstadoEntrega,
  EstadoPedido,
  Prisma,
  Role,
} from '../../generated/prisma/client';
import { round2 } from '../common/money';
import { fechaMexicoYMD } from './pedidos-b2b-logica';

/**
 * Estados de un pedido B2B (fuente de verdad: docs/diseno-operacion.md, "Flujo operativo y estados").
 *
 *  · PENDIENTE_CONFIRMACION → CONFIRMADO_SURTIENDO es manual (avanzar).
 *  · EN_PROCESO / COMPLETADO se CALCULAN de las entregas (recalcularEstadoB2b) y se GUARDAN en Order.estadoPedido.
 *  · "Cancelado" NO es un valor: es Order.cancelado (única fuente, igual que en B2C).
 *  · DESPACHADO ya no existe para B2B. Mientras la migración de datos no corra (src/scripts/b2b-estados.ts), una orden B2B
 *    que siga en DESPACHADO se lee como COMPLETADO (estadoB2bVisible) — así el orden de despliegue es indiferente.
 */

/** Estados que la lectura trata como "pedido activo" (Pedidos activos): todo menos completado/cancelado. */
export const ESTADOS_B2B_ACTIVOS: EstadoPedido[] = [
  EstadoPedido.PENDIENTE_CONFIRMACION,
  EstadoPedido.CONFIRMADO_SURTIENDO,
  EstadoPedido.EN_PROCESO,
];

/** Valores de BD que equivalen a COMPLETADO (incluye el DESPACHADO heredado, antes de migrar). */
export const ESTADOS_B2B_COMPLETADOS: EstadoPedido[] = [
  EstadoPedido.COMPLETADO,
  EstadoPedido.DESPACHADO,
];

/** Valores del filtro `estado` de la API B2B. */
export const ESTADOS_B2B_FILTRO = [
  'PENDIENTE_CONFIRMACION',
  'CONFIRMADO_SURTIENDO',
  'EN_PROCESO',
  'COMPLETADO',
  'DESPACHADO',
] as const;
export type EstadoB2bFiltro = (typeof ESTADOS_B2B_FILTRO)[number];

/** Estado B2B que ve la API: DESPACHADO heredado se muestra como COMPLETADO. */
export function estadoB2bVisible(estado: EstadoPedido): EstadoPedido {
  return estado === EstadoPedido.DESPACHADO ? EstadoPedido.COMPLETADO : estado;
}

/** Valores de BD que cubre un filtro por estado (COMPLETADO también abarca el DESPACHADO heredado). */
export function estadosDeBdParaFiltro(estado: EstadoB2bFiltro): EstadoPedido[] {
  const e = estado as EstadoPedido;
  return ESTADOS_B2B_COMPLETADOS.includes(e) ? ESTADOS_B2B_COMPLETADOS : [e];
}

/** Valores del filtro `estadoPago` de la API B2B (el pago B2B solo tiene Pendiente y Pagado). */
export const ESTADOS_PAGO_B2B_FILTRO = ['PENDIENTE', 'PAGADO'] as const;
export type EstadoPagoB2bFiltro = (typeof ESTADOS_PAGO_B2B_FILTRO)[number];

/**
 * ¿Puede este rol editar un pedido B2B ya Pagado? Gerente y Dueño (admin) sí; el Operador no (docs/diseno-operacion.md,
 * "Roles y permisos": un pedido marcado como Pagado queda bloqueado para él). Hoy editar es solo de Gerente/Dueño a nivel de
 * ruta; esta regla queda lista para cuando el Operador reciba permiso de editar.
 */
export function puedeEditarPedidoPagado(rol: Role): boolean {
  return rol === Role.GERENTE || rol === Role.DUENO;
}

export const ESTADOS_ENTREGA_CERRADOS: EstadoEntrega[] = [
  EstadoEntrega.ENTREGADA,
  EstadoEntrega.NO_RECOGIDA,
];
/** Cuentan para el cobro: las cerradas y las que siguen por entregar; solo CANCELADA no se cobra. */
export const ESTADOS_ENTREGA_COBRABLES: EstadoEntrega[] = [
  EstadoEntrega.PENDIENTE,
  EstadoEntrega.LISTA,
  EstadoEntrega.ENTREGADA,
  EstadoEntrega.NO_RECOGIDA,
];

/** Estado calculado a partir de las entregas no canceladas (null si no hay ninguna: no hay nada que calcular). */
export function estadoDesdeEntregas(
  estados: EstadoEntrega[],
): EstadoPedido | null {
  const vigentes = estados.filter((e) => e !== EstadoEntrega.CANCELADA);
  if (vigentes.length === 0) return null;
  const cerradas = vigentes.filter((e) =>
    ESTADOS_ENTREGA_CERRADOS.includes(e),
  ).length;
  if (cerradas === vigentes.length) return EstadoPedido.COMPLETADO;
  return cerradas > 0
    ? EstadoPedido.EN_PROCESO
    : EstadoPedido.CONFIRMADO_SURTIENDO;
}

/**
 * Recalcula y guarda Order.estadoPedido de una orden B2B a partir de sus entregas. NO toca órdenes canceladas ni
 * PENDIENTE_CONFIRMACION (ahí el estado es manual). Devuelve el estado resultante. Llamar dentro de la transacción que
 * cambió las entregas, con la orden ya bloqueada (FOR UPDATE).
 */
export async function recalcularEstadoB2b(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<EstadoPedido> {
  const orden = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { estadoPedido: true, cancelado: true },
  });
  if (
    orden.cancelado ||
    orden.estadoPedido === EstadoPedido.PENDIENTE_CONFIRMACION
  )
    return orden.estadoPedido;
  const entregas = await tx.entrega.findMany({
    where: { orderId },
    select: { estado: true },
  });
  const nuevo = estadoDesdeEntregas(entregas.map((e) => e.estado));
  if (!nuevo || nuevo === orden.estadoPedido) return orden.estadoPedido;
  await tx.order.update({
    where: { id: orderId },
    data: { estadoPedido: nuevo },
  });
  return nuevo;
}

/**
 * Recalcula subtotal / descuento / total contando SOLO las entregas no canceladas (precio del ítem × cantidad de cada
 * EntregaItem). El % de descuento es el que el pedido guardó al crearse. `totalPiezas` y `OrderItem.cantidad` no cambian
 * (siguen describiendo lo que se pidió).
 */
export async function recalcularTotalesB2b(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const detalle = await tx.detalleB2B.findUniqueOrThrow({
    where: { orderId },
    select: { descuentoPorcentajeAplicado: true },
  });
  const filas = await tx.entregaItem.findMany({
    where: { entrega: { orderId, estado: { not: EstadoEntrega.CANCELADA } } },
    select: { cantidad: true, orderItem: { select: { precioUnitario: true } } },
  });
  const subtotal = round2(
    filas.reduce(
      (suma, f) => suma + Number(f.orderItem.precioUnitario) * f.cantidad,
      0,
    ),
  );
  const porcentaje = detalle.descuentoPorcentajeAplicado
    ? Number(detalle.descuentoPorcentajeAplicado)
    : 0;
  const descuentoTotal = round2(subtotal * (porcentaje / 100));
  const total = round2(subtotal - descuentoTotal);
  await tx.detalleB2B.update({ where: { orderId }, data: { subtotal } });
  await tx.order.update({
    where: { id: orderId },
    data: { descuentoTotal, total },
  });
  return { subtotal, descuentoTotal, total };
}

/** "Atrasada": entrega aún PENDIENTE de un día anterior a hoy (hora de Ciudad de México). No se cierra sola. */
export function entregaAtrasada(
  estado: EstadoEntrega,
  fecha: Date,
  hoy = fechaMexicoYMD(),
): boolean {
  return (
    estado === EstadoEntrega.PENDIENTE && fecha.toISOString().slice(0, 10) < hoy
  );
}
