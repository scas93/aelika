"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { getNavItems, type NavItem } from "./nav-items";
import UserMenu from "./_components/UserMenu";

interface DashboardNavProps {
  open: boolean;
  onClose: () => void;
}

export default function DashboardNav({ open, onClose }: DashboardNavProps) {
  const { user } = useSession();
  const pathname = usePathname();
  const items = getNavItems(user.rol, user.tenant.tipoStorefront, user.tenant.modulosDesactivados);

  // Below md this is a left-edge drawer (fixed, off-canvas via
  // -translate-x-full, slides in when open); at md+ it reverts to the
  // always-visible static sidebar regardless of `open` — same pattern
  // SidePanel already uses for its own open/mount transition, just
  // mirrored to the left edge instead of the right. Not SidePanel itself:
  // different shape (nav list vs. form panel), same reasoning SidePanel
  // didn't reuse Modal literally either.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Body scroll lock while the mobile drawer is open — neither Modal nor
  // SidePanel do this today (confirmed before implementing), so there was
  // nothing to reuse here; this is the first consumer of the pattern.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    // Closes the mobile drawer on every route change, including the
    // initial mount (harmless no-op there since it's already closed).
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} aria-hidden="true" />
      )}

      {/* Fondo claro (bg-white) + borde derecho para separarse del
          contenido — reemplaza --color-admin-sidebar (#121a24), que se
          eliminó de globals.css: este era su único consumidor en toda la
          app. El drawer mobile es este mismo <aside>, así que hereda el
          estilo claro sin ningún cambio aparte. */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-[320px] shrink-0 flex-col md:w-[224px] border-r border-admin-border bg-white font-admin transition-transform duration-200 md:sticky md:top-0 md:h-dvh md:translate-x-0 md:self-start ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Un solo bloque arriba: negocio + usuario (con su menú). Reemplaza al encabezado fijo y al bloque del usuario del fondo. */}
        <div className="flex shrink-0 items-center gap-1 border-b border-admin-border p-3">
          <div className="min-w-0 flex-1">
            <UserMenu onCerrarDrawer={onClose} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar menú"
            className="shrink-0 p-1 text-xl leading-none text-admin-ink-soft transition hover:text-admin-ink md:hidden"
          >
            ✕
          </button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
          {items.map((item) =>
            item.children ? (
              <NavGroup key={item.href} item={item} pathname={pathname} />
            ) : (
              <NavLink key={item.href} item={item} active={pathname === item.href} />
            ),
          )}
        </nav>

      </aside>
    </>
  );
}

function NavLink({ item, active, indent = false }: { item: NavItem; active: boolean; indent?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex h-10 items-center gap-3 rounded-[var(--radius-admin-control)] px-3 transition ${indent ? "ml-3" : ""} ${
        active ? "bg-admin-accent-soft text-admin-accent-dark" : "text-admin-ink-soft hover:bg-admin-bg hover:text-admin-ink"
      }`}
    >
      <Icon size={18} className="shrink-0" />
      <span className={`text-sm ${active ? "font-semibold" : ""}`}>{item.label}</span>
    </Link>
  );
}

// Primer consumidor de NavItem.children (ver ese campo en nav-items.ts) —
// encabezado no clickeable (mismo tratamiento tipográfico que el resto del
// panel para encabezados de sección — uppercase + ink-soft, ver
// SECTION_HEADER en otras pantallas — ya no la escala white/* de opacidad
// que asumía fondo oscuro) + hijos indentados debajo con una línea
// conectora sutil, siempre expandido. `pathname` decide el activo de cada
// hijo con startsWith (no === ) — así "Recontacto" se resalta tanto en su
// listado como en /recontacto/nueva o /recontacto/[id].
function NavGroup({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-10 items-center gap-3 px-3">
        <Icon size={18} className="shrink-0 text-admin-ink-soft" />
        <span className="text-xs font-bold uppercase tracking-wide text-admin-ink-soft">{item.label}</span>
      </div>
      <div className="ml-[19px] flex flex-col gap-1 border-l border-admin-border pl-1">
        {item.children?.map((child) => (
          <NavLink key={child.href} item={child} active={pathname.startsWith(child.href)} indent />
        ))}
      </div>
    </div>
  );
}
