"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { getNavItems } from "./nav-items";
import Button from "./_components/Button";

interface DashboardNavProps {
  open: boolean;
  onClose: () => void;
}

export default function DashboardNav({ open, onClose }: DashboardNavProps) {
  const { user, logout } = useSession();
  const pathname = usePathname();
  const items = getNavItems(user.rol, user.tenant.tipoStorefront);
  const tenantInitial = user.tenant.nombre.trim().charAt(0).toUpperCase();

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

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[224px] shrink-0 flex-col bg-admin-sidebar font-admin transition-transform duration-200 md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 border-b border-white/10 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-admin-control)] bg-admin-green text-sm font-bold text-white">
            {tenantInitial}
          </div>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <p className="truncate text-[15px] font-semibold text-white">{user.tenant.nombre}</p>
            <p className="truncate text-[13px] text-white/60">Panel administrativo</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar menú"
            className="shrink-0 text-xl leading-none text-white/60 transition hover:text-white md:hidden"
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex h-11 items-center gap-3 rounded-md border-l-[3px] px-4 transition ${
                  active ? "border-admin-green bg-white/8" : "border-transparent hover:bg-white/5"
                }`}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-admin-control)] text-sm"
                  style={{ backgroundColor: item.iconBg, color: item.iconColor }}
                >
                  {item.emoji}
                </span>
                <span className={active ? "text-[15px] font-semibold text-white" : "text-[15px] text-white/80"}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3">
          <Button variant="secondary" onDark fullWidth onClick={logout}>
            Cerrar sesión
          </Button>
        </div>
      </aside>
    </>
  );
}
