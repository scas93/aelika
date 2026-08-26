import type { PedidoB2bEstado } from "@/lib/api";

export const ESTADO_LABEL: Record<PedidoB2bEstado, string> = {
  PENDIENTE_CONFIRMACION: "Pendiente de confirmación",
  CONFIRMADO_SURTIENDO: "Confirmado y surtiendo",
  DESPACHADO: "Despachado",
};

// Mismo criterio que pedidos/estado.ts (ESTADO_COLOR): pill sólido, texto
// blanco. DESPACHADO no se usa en esta vista (pertenece a Históricos) pero
// se define completo por si algo más lo reutiliza.
export const ESTADO_COLOR: Record<PedidoB2bEstado, string> = {
  PENDIENTE_CONFIRMACION: "bg-gray-500 text-white",
  CONFIRMADO_SURTIENDO: "bg-amber-700 text-white",
  DESPACHADO: "bg-admin-ink text-white",
};

// "Pedidos activos" = todo lo que no sea DESPACHADO ni esté cancelado — ver
// CLAUDE.md. Un pedido despachado pertenece a Históricos (fase futura).
export const ESTADOS_ACTIVOS: PedidoB2bEstado[] = ["PENDIENTE_CONFIRMACION", "CONFIRMADO_SURTIENDO"];

// Espejo de la secuencia fija del servidor (ver PedidosB2bService) — solo
// para etiquetar el botón "Confirmar pedido". La transición real siempre la
// calcula PATCH /pedidos-b2b/:id/avanzar.
export const SIGUIENTE_ESTADO: Partial<Record<PedidoB2bEstado, PedidoB2bEstado>> = {
  PENDIENTE_CONFIRMACION: "CONFIRMADO_SURTIENDO",
  CONFIRMADO_SURTIENDO: "DESPACHADO",
};
