import type { Role } from "@/lib/api";

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
  { href: "/dashboard/catalogo", label: "Catálogo", emoji: "📋", iconBg: "#EDE9FE", iconColor: "#8B5CF6" },
  { href: "/dashboard/equipo", label: "Equipo", emoji: "👥", iconBg: "#FCE7F3", iconColor: "#EC4899" },
  { href: "/dashboard/configuracion", label: "Configuración", emoji: "⚙️", iconBg: "#E2E8F0", iconColor: "#64748B" },
  { href: "/dashboard/cambiar-password", label: "Contraseña", emoji: "🔑", iconBg: "#CCFBF1", iconColor: "#14B8A6" },
];

export function getNavItems(rol: Role): NavItem[] {
  return ALL_NAV_ITEMS.filter((item) => {
    if (item.href === "/dashboard/catalogo") return rol !== "OPERADOR";
    if (item.href === "/dashboard/equipo" || item.href === "/dashboard/configuracion") return rol === "DUENO";
    return true;
  });
}
