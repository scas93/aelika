import type { EstadoPago, EstadoPedido, GrupoEstadoPago } from "@/lib/api";
import type { BadgeVariant } from "../_components/Badge";

export const ESTADO_LABEL: Record<EstadoPedido, string> = {
  PENDIENTE_CONFIRMACION: "Pendiente",
  CONFIRMADO_SURTIENDO: "Confirmado y surtiendo",
  LISTO_ENTREGA: "Listo para entrega",
  DESPACHADO: "Despachado",
};

// Significado de los colores (ver Badge.tsx): ámbar = requiere acción, azul = en curso, verde = terminado bien, rojo = terminado
// mal, gris = normal. «Pendiente» va en gris (no ámbar): hay negocios, como Entredós, que no usan este flujo, y
// no debe verse como alerta.
export const ESTADO_VARIANT: Record<EstadoPedido, BadgeVariant> = {
  PENDIENTE_CONFIRMACION: "neutro",
  CONFIRMADO_SURTIENDO: "info",
  LISTO_ENTREGA: "info",
  DESPACHADO: "exito",
};

export const ESTADOS: EstadoPedido[] = ["PENDIENTE_CONFIRMACION", "CONFIRMADO_SURTIENDO", "LISTO_ENTREGA", "DESPACHADO"];

// Display-only mirror of the server's fixed sequence (see CLAUDE.md) — used
// just to label the "Avanzar a: {siguiente}" button. The actual transition
// is still entirely server-computed by PATCH /orders/:id/avanzar.
export const SIGUIENTE_ESTADO: Partial<Record<EstadoPedido, EstadoPedido>> = {
  PENDIENTE_CONFIRMACION: "CONFIRMADO_SURTIENDO",
  CONFIRMADO_SURTIENDO: "LISTO_ENTREGA",
  LISTO_ENTREGA: "DESPACHADO",
};

// Only REEMBOLSADO gets a label here (see OrderCard) — PENDIENTE/PAGADO/
// FALLIDO for a TARJETA order aren't surfaced as text in this card today.
export const ESTADO_PAGO_LABEL: Partial<Record<EstadoPago, string>> = {
  REEMBOLSADO: "Reembolsado",
};

// UN solo mapeo de EstadoPago para todo el panel (B2C, B2B y tabla de Pagos). Exhaustivo (no Partial) a propósito — pagos/page.tsx
// muestra los 5 valores. PROCESANDO no ocurre hoy en una fila de Payment, pero el Record debe seguir siendo exhaustivo.
export const ESTADO_PAGO_VARIANT: Record<EstadoPago, BadgeVariant> = {
  PENDIENTE: "neutro",
  PROCESANDO: "info",
  PAGADO: "exito",
  FALLIDO: "peligro",
  REEMBOLSADO: "oscuro",
};

// Estado de pago tal como lo ve el negocio (histórico, filtro): PENDIENTE,
// PROCESANDO y FALLIDO se muestran igual, "Pago no completado" — un intento
// de pago, no un pedido. Espejo de backend/src/common/estado-pago.ts.
export const GRUPOS_ESTADO_PAGO: GrupoEstadoPago[] = ["PAGADO", "NO_COMPLETADO", "REEMBOLSADO"];

export const GRUPO_ESTADO_PAGO_LABEL: Record<GrupoEstadoPago, string> = {
  PAGADO: "Pagado",
  NO_COMPLETADO: "Pago no completado",
  REEMBOLSADO: "Reembolsado",
};

export const GRUPO_ESTADO_PAGO_VARIANT: Record<GrupoEstadoPago, BadgeVariant> = {
  PAGADO: "exito",
  NO_COMPLETADO: "neutro",
  REEMBOLSADO: "oscuro",
};

export function grupoDeEstadoPago(estado: EstadoPago): GrupoEstadoPago {
  if (estado === "PAGADO") return "PAGADO";
  if (estado === "REEMBOLSADO") return "REEMBOLSADO";
  return "NO_COMPLETADO";
}
