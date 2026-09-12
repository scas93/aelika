import type { PedidoB2bEstado } from "@/lib/api";
import type { BadgeVariant } from "../_components/Badge";

export const ESTADO_LABEL: Record<PedidoB2bEstado, string> = {
  PENDIENTE_CONFIRMACION: "Pendiente de confirmación",
  CONFIRMADO_SURTIENDO: "Confirmado y surtiendo",
  DESPACHADO: "Despachado",
};

// Mismo mapeo semántico que pedidos/estado.ts (ESTADO_VARIANT) — mismo
// criterio (PENDIENTE=neutro, CONFIRMADO=advertencia, DESPACHADO=oscuro),
// pero como Record propio tipado por PedidoB2bEstado (3 valores, nunca tuvo
// LISTO_ENTREGA) en vez de un solo Record compartido — así TypeScript sigue
// obligando a mapear cualquier estado nuevo que agregue cada enum por
// separado. El color real (qué se ve "neutro", qué se ve "oscuro") vive una
// sola vez en Badge (_components/Badge.tsx), no reimplementado aquí.
// DESPACHADO no se usa en esta vista (pertenece a Históricos) pero se
// define completo por si algo más lo reutiliza.
export const ESTADO_VARIANT: Record<PedidoB2bEstado, BadgeVariant> = {
  PENDIENTE_CONFIRMACION: "neutro",
  CONFIRMADO_SURTIENDO: "advertencia",
  DESPACHADO: "oscuro",
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
