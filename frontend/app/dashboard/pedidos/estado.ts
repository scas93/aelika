import type { EstadoPago, EstadoPedido } from "@/lib/api";
import type { BadgeVariant } from "../_components/Badge";

export const ESTADO_LABEL: Record<EstadoPedido, string> = {
  PENDIENTE_CONFIRMACION: "Pendiente de confirmación",
  CONFIRMADO_SURTIENDO: "Confirmado y surtiendo",
  LISTO_ENTREGA: "Listo para entrega",
  DESPACHADO: "Despachado",
};

// Mapea cada estado a una variante semántica de Badge (_components/Badge.tsx)
// — el color en sí (qué se ve "exito", qué se ve "advertencia") vive ahora
// una sola vez ahí, no reimplementado aquí. DESPACHADO usa "oscuro" (no
// "neutro") para no perder la distinción visual que ya existía entre
// PENDIENTE_CONFIRMACION (apenas empieza) y DESPACHADO (ya terminó) — ver
// prompt de unificación de tokens.
export const ESTADO_VARIANT: Record<EstadoPedido, BadgeVariant> = {
  PENDIENTE_CONFIRMACION: "neutro",
  CONFIRMADO_SURTIENDO: "advertencia",
  LISTO_ENTREGA: "exito",
  DESPACHADO: "oscuro",
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

// Exhaustivo (no Partial) a propósito — pagos/page.tsx también lo consume
// para su columna Estado, que sí muestra los 5 valores de EstadoPago, no
// solo REEMBOLSADO. PROCESANDO no tenía precedente en ningún lado del
// proyecto antes de esto (Payment nunca se creaba en ese estado, ver
// comentario en pagos/page.tsx) — se mapeó a "advertencia" por el mismo
// criterio que PENDIENTE (algo en curso, no resuelto todavía); repórtese si
// no es la semántica que se quería.
export const ESTADO_PAGO_VARIANT: Record<EstadoPago, BadgeVariant> = {
  PENDIENTE: "advertencia",
  PROCESANDO: "advertencia",
  PAGADO: "exito",
  FALLIDO: "peligro",
  REEMBOLSADO: "peligro",
};
