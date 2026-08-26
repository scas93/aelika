import type { Role, TipoStorefront } from "@/lib/api";

export interface NavItem {
  href: string;
  label: string;
  emoji: string;
  // Per-section accent pair for the sidebar/topbar icon badge — soft
  // background + saturated icon color, one distinct pair per section.
  iconBg: string;
  iconColor: string;
}

// Single source of truth for both the sidebar (role-filtered) and the
// topbar (unfiltered — it only needs a title for whatever route is
// current, not to gate access).
export const ALL_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Inicio", emoji: "🏠", iconBg: "#DBEAFE", iconColor: "#3B82F6" },
  { href: "/dashboard/pedidos", label: "Pedidos", emoji: "🧾", iconBg: "#FEF3C7", iconColor: "#F59E0B" },
  { href: "/dashboard/pedidos/historico", label: "Histórico", emoji: "📜", iconBg: "#FEF3C7", iconColor: "#F59E0B" },
  { href: "/dashboard/pagos", label: "Pagos", emoji: "💳", iconBg: "#DCFCE7", iconColor: "#16A34A" },
  // Solo RETAIL_B2B (ver getNavItems abajo) — mismo tono ámbar que usa el
  // storefront público /mayoreo/[slug] (--color-mayoreo-accent), para que
  // ambas superficies del módulo B2B se sientan como la misma cosa.
  { href: "/dashboard/pedidos-b2b", label: "Pedidos activos", emoji: "📦", iconBg: "#FEF3E2", iconColor: "#B45309" },
  { href: "/dashboard/pedidos-b2b/dia", label: "Pedidos del día", emoji: "🚚", iconBg: "#FEF3E2", iconColor: "#B45309" },
  { href: "/dashboard/pedidos-b2b/historico", label: "Históricos", emoji: "📜", iconBg: "#FEF3E2", iconColor: "#B45309" },
  { href: "/dashboard/catalogo", label: "Catálogo", emoji: "📋", iconBg: "#EDE9FE", iconColor: "#8B5CF6" },
  { href: "/dashboard/equipo", label: "Equipo", emoji: "👥", iconBg: "#FCE7F3", iconColor: "#EC4899" },
  { href: "/dashboard/configuracion", label: "Configuración", emoji: "⚙️", iconBg: "#E2E8F0", iconColor: "#64748B" },
  { href: "/dashboard/cambiar-password", label: "Contraseña", emoji: "🔑", iconBg: "#CCFBF1", iconColor: "#14B8A6" },
];

// Pedidos/Histórico/Pagos operan sobre Order (carrito + pago inmediato) y
// Payment (solo se llena vía webhook de Stripe atado a Order.metodoPago =
// TARJETA) — ninguno de los dos aplica al flujo de PedidoB2b (pedido semanal
// a crédito, confirmación de pago manual, sin Stripe). No es una lista
// temporal: cuando existan los módulos de "Pedidos activos"/"Pedidos del
// día"/"Históricos" propios de B2B (fase futura), se agregan aparte —
// ocultar estos tres no es lo mismo que ya tener sus reemplazos.
const HREFS_NO_APLICAN_A_RETAIL_B2B = new Set([
  "/dashboard/pedidos",
  "/dashboard/pedidos/historico",
  "/dashboard/pagos",
]);

// Inverso del set de arriba — módulos propios de B2B que no aplican a
// RETAIL_B2C (opera sobre PedidoB2b, que un tenant B2C nunca genera).
const HREFS_SOLO_RETAIL_B2B = new Set([
  "/dashboard/pedidos-b2b",
  "/dashboard/pedidos-b2b/dia",
  "/dashboard/pedidos-b2b/historico",
]);

export function getNavItems(rol: Role, tipoStorefront: TipoStorefront): NavItem[] {
  return ALL_NAV_ITEMS.filter((item) => {
    if (item.href === "/dashboard/catalogo") return rol !== "OPERADOR";
    if (item.href === "/dashboard/equipo" || item.href === "/dashboard/configuracion") return rol === "DUENO";
    if (tipoStorefront === "RETAIL_B2B" && HREFS_NO_APLICAN_A_RETAIL_B2B.has(item.href)) return false;
    if (tipoStorefront !== "RETAIL_B2B" && HREFS_SOLO_RETAIL_B2B.has(item.href)) return false;
    return true;
  });
}
