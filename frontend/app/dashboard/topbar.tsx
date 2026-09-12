"use client";

import { usePathname } from "next/navigation";
import { ALL_NAV_ITEMS, buscarPorHref } from "./nav-items";

interface DashboardTopbarProps {
  onOpenSidebar: () => void;
}

// UserMenu (avatar+nombre+Cerrar sesión/Cambiar contraseña) ya no vive aquí
// — se movió al fondo del sidebar (ver nav.tsx). En mobile, eso significa
// que ya no hay acceso directo a "Cerrar sesión" desde la topbar: hay que
// abrir el drawer con el botón hamburguesa primero. Ver prompt de esta
// etapa — se reporta en vez de decidir si hace falta un atajo aparte.
export default function DashboardTopbar({ onOpenSidebar }: DashboardTopbarProps) {
  const pathname = usePathname();
  const current = buscarPorHref(ALL_NAV_ITEMS, pathname ?? "");
  const title = current?.label ?? "Aelika";

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-admin-border bg-white px-4 py-4 font-admin md:px-8">
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label="Abrir menú"
        className="text-2xl leading-none text-admin-ink-soft transition hover:text-admin-ink md:hidden"
      >
        ☰
      </button>
      <h1 className="text-[28px] font-bold text-admin-ink">{title}</h1>
    </header>
  );
}
