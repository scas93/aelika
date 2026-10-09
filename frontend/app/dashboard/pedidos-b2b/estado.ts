import type { PedidoB2bEstado, PedidoB2bEstadoEntrega, PedidoB2bEstadoPago } from "@/lib/api";
import type { BadgeVariant } from "../_components/Badge";

export const ESTADO_LABEL: Record<PedidoB2bEstado, string> = {
  PENDIENTE_CONFIRMACION: "Por confirmar",
  CONFIRMADO_SURTIENDO: "Confirmado",
  EN_PROCESO: "En proceso",
  COMPLETADO: "Completado",
  // Heredado: el servidor ya lo entrega como COMPLETADO; se define por si el tipo lo incluye.
  DESPACHADO: "Completado",
};

// Mismo mapeo semántico que pedidos/estado.ts (ESTADO_VARIANT), como Record propio tipado por PedidoB2bEstado — así
// TypeScript obliga a mapear cualquier estado nuevo. El color real vive una sola vez en Badge. "Cancelado" no es un valor
// del estado: se resuelve con `cancelado` (variante "peligro") donde corresponde.
export const ESTADO_VARIANT: Record<PedidoB2bEstado, BadgeVariant> = {
  PENDIENTE_CONFIRMACION: "neutro",
  CONFIRMADO_SURTIENDO: "advertencia",
  EN_PROCESO: "acento",
  COMPLETADO: "oscuro",
  DESPACHADO: "oscuro",
};

// "Pedidos activos" = Por confirmar, Confirmado y En proceso (y no cancelado). Completado y Cancelado van a Históricos.
export const ESTADOS_ACTIVOS: PedidoB2bEstado[] = ["PENDIENTE_CONFIRMACION", "CONFIRMADO_SURTIENDO", "EN_PROCESO"];

// Históricos solo muestra pedidos Completados y Cancelados: el filtro de estado se limita a esos dos (los pedidos activos viven
// en Pedidos activos). CANCELADO no es un valor del backend: se manda como `cancelado=true`.
export type EstadoFiltroHistorico = "COMPLETADO" | "CANCELADO";
export const ESTADOS_FILTRO_HISTORICO: EstadoFiltroHistorico[] = ["COMPLETADO", "CANCELADO"];
export const ESTADO_FILTRO_LABEL: Record<EstadoFiltroHistorico, string> = {
  COMPLETADO: ESTADO_LABEL.COMPLETADO,
  CANCELADO: "Cancelado",
};

// Un pedido solo deja cerrar entregas estando Confirmado o En proceso (y no cancelado) — espejo de la regla del servidor,
// que es la fuente de verdad (409 si no se cumple).
export function puedeCerrarEntregas(estado: PedidoB2bEstado, cancelado: boolean): boolean {
  return !cancelado && (estado === "CONFIRMADO_SURTIENDO" || estado === "EN_PROCESO");
}

// Estado de pago del pedido B2B: solo Pendiente y Pagado, independiente del estado operativo.
export const ESTADO_PAGO_LABEL: Record<PedidoB2bEstadoPago, string> = { PENDIENTE: "Pendiente", PAGADO: "Pagado" };
export const ESTADO_PAGO_VARIANT: Record<PedidoB2bEstadoPago, BadgeVariant> = { PENDIENTE: "neutro", PAGADO: "exito" };
export const ESTADOS_PAGO_FILTRO: PedidoB2bEstadoPago[] = ["PENDIENTE", "PAGADO"];

export const ESTADO_ENTREGA_LABEL: Record<PedidoB2bEstadoEntrega, string> = {
  PENDIENTE: "Pendiente",
  LISTA: "Lista",
  ENTREGADA: "Entregada",
  NO_RECOGIDA: "No recogida",
  CANCELADA: "Cancelada",
};

export const ESTADO_ENTREGA_VARIANT: Record<PedidoB2bEstadoEntrega, BadgeVariant> = {
  PENDIENTE: "neutro",
  LISTA: "advertencia",
  ENTREGADA: "exito",
  NO_RECOGIDA: "oscuro",
  CANCELADA: "peligro",
};
