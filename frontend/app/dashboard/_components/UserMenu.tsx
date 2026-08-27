"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session-context";

// Botón de "Mi perfil" en la esquina superior derecha del topbar — mismo
// patrón de círculo+inicial que ya usa nav.tsx para el tenant, pero
// identifica al usuario logueado (user.nombre), no al negocio.
export default function UserMenu() {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);

  const inicial = user.nombre.trim().charAt(0).toUpperCase();

  // Cierra al hacer click fuera — mismo mecanismo de "click outside" que no
  // existía todavía en ningún componente del panel (DashboardNav cierra su
  // drawer con un backdrop a pantalla completa, no con este patrón).
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Cierra en cada cambio de ruta — mismo efecto que ya usa DashboardNav
  // para su drawer móvil al navegar.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div ref={containerRef} className="relative ml-auto shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition hover:bg-admin-bg sm:pr-3"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-admin-green text-sm font-bold text-white">
          {inicial}
        </span>
        <span className="hidden text-sm font-semibold text-admin-ink sm:inline">{user.nombre}</span>
        <span className={`text-xs text-admin-ink-soft transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-[var(--radius-admin-card)] border border-admin-border bg-white shadow-lg"
        >
          <Link
            href="/dashboard/cambiar-password"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2.5 text-sm text-admin-ink transition hover:bg-admin-bg"
          >
            Cambiar contraseña
          </Link>
        </div>
      )}
    </div>
  );
}
