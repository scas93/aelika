import type { Role } from "@/lib/api";

export interface NavItem {
  href: string;
  label: string;
  emoji: string;
}

// Single source of truth for both the sidebar (role-filtered) and the
// topbar (unfiltered — it only needs a title for whatever route is
// current, not to gate access).
export const ALL_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Inicio", emoji: "🏠" },
  { href: "/dashboard/pedidos", label: "Pedidos", emoji: "🧾" },
  { href: "/dashboard/catalogo", label: "Catálogo", emoji: "📋" },
  { href: "/dashboard/equipo", label: "Equipo", emoji: "👥" },
  { href: "/dashboard/configuracion", label: "Configuración", emoji: "⚙️" },
  { href: "/dashboard/cambiar-password", label: "Contraseña", emoji: "🔑" },
];

export function getNavItems(rol: Role): NavItem[] {
  return ALL_NAV_ITEMS.filter((item) => {
    if (item.href === "/dashboard/catalogo") return rol !== "OPERADOR";
    if (item.href === "/dashboard/equipo" || item.href === "/dashboard/configuracion") return rol === "DUENO";
    return true;
  });
}
