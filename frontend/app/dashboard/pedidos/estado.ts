import type { EstadoPago, EstadoPedido } from "@/lib/api";

export const ESTADO_LABEL: Record<EstadoPedido, string> = {
  PENDIENTE_CONFIRMACION: "Pendiente de confirmación",
  CONFIRMADO_SURTIENDO: "Confirmado y surtiendo",
  LISTO_ENTREGA: "Listo para entrega",
  DESPACHADO: "Despachado",
};

// Solid pill badges, white bold text — gris/ámbar/verde per the mockup;
// DESPACHADO isn't specified there, so it uses admin-ink (dark neutral =
// done/archived, consistent with the rest of the palette). LISTO_ENTREGA
// uses the darker admin-green-dark rather than the bright accent green —
// white text on the bright #25D366 accent doesn't meet contrast at this
// badge's text size, admin-green-dark does. Full "bg-x text-white" class
// pairs (not just the background) — Badge (_components/Badge.tsx) expects
// the complete color className since Fase 3.
export const ESTADO_COLOR: Record<EstadoPedido, string> = {
  PENDIENTE_CONFIRMACION: "bg-gray-500 text-white",
  CONFIRMADO_SURTIENDO: "bg-amber-700 text-white",
  LISTO_ENTREGA: "bg-admin-green-dark text-white",
  DESPACHADO: "bg-admin-ink text-white",
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

// Only REEMBOLSADO gets shown here as a badge (see OrderCard) — PENDIENTE/
// PAGADO/FALLIDO for a TARJETA order aren't surfaced in this card today, so
// there's no existing color for them to be consistent with. red-600 matches
// the only other "money going backwards" color already in the app (discount
// lines in /tienda's checkout — see CLAUDE.md).
export const ESTADO_PAGO_LABEL: Partial<Record<EstadoPago, string>> = {
  REEMBOLSADO: "Reembolsado",
};

export const ESTADO_PAGO_COLOR: Partial<Record<EstadoPago, string>> = {
  REEMBOLSADO: "bg-red-600 text-white",
};
