"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChevronDown, IconKey, IconLogout } from "@tabler/icons-react";
import { useSession } from "@/lib/session-context";

// Botón "Mi perfil" al fondo del sidebar — mismo patrón de círculo+inicial
// que ya usa nav.tsx para el negocio, pero identifica al usuario logueado
// (user.nombre), no al negocio. Antes vivía en la topbar (fila horizontal,
// panel desplegándose hacia abajo); ahora es una fila de ancho completo al
// fondo del sidebar y el panel se despliega hacia ARRIBA (`bottom-full`, no
// `top-full`) — pegado al borde inferior del viewport, "hacia abajo" se
// saldría de la pantalla.
export default function UserMenu() {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);

  const inicial = user.nombre.trim().charAt(0).toUpperCase();

  // Cierra al hacer click fuera.
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

  // Cierra en cada cambio de ruta.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div ref={containerRef} className="relative w-full">
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-[var(--radius-admin-card)] border border-admin-border bg-white shadow-lg"
        >
          <Link
            href="/dashboard/cambiar-password"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-admin-ink transition hover:bg-admin-bg"
          >
            <IconKey size={16} className="shrink-0 text-admin-ink-soft" />
            Cambiar contraseña
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="flex w-full items-center gap-2.5 border-t border-admin-border px-4 py-2.5 text-left text-sm text-admin-red transition hover:bg-admin-red-soft"
          >
            <IconLogout size={16} className="shrink-0" />
            Cerrar sesión
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-admin-control)] px-2 py-2 transition hover:bg-admin-bg"
      >
        {/* admin-green a propósito — inicial del usuario como avatar
            estático, mismo criterio/excepción que el logo del negocio en
            nav.tsx (marca, no interacción). */}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-admin-green text-sm font-bold text-white">
          {inicial}
        </span>
        <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-admin-ink">{user.nombre}</span>
        <IconChevronDown size={16} className={`shrink-0 text-admin-ink-soft transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
    </div>
  );
}
