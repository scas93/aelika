"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconChevronDown, IconKey, IconLogout } from "@tabler/icons-react";
import { useSession } from "@/lib/session-context";

const ROL_LABEL = { OPERADOR: "Operador", GERENTE: "Gerente", DUENO: "Dueño" } as const;

// Bloque superior de la barra lateral: logo y nombre del negocio, y debajo el rol y el nombre del usuario con una flecha (el rol va primero para que se vea aunque el nombre se recorte). Al hacer clic se
// abre el menú del usuario (cambiar contraseña, cerrar sesión), que se despliega hacia abajo. Un solo bloque para todos los tenants.
export default function UserMenu({ onCerrarDrawer }: { onCerrarDrawer?: () => void }) {
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);

  const tenantInitial = user.tenant.nombre.trim().charAt(0).toUpperCase();

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

  // Cierra en cada cambio de ruta (ajuste de estado durante el render, en vez de un efecto con setState).
  const [rutaPrevia, setRutaPrevia] = useState(pathname);
  if (rutaPrevia !== pathname) {
    setRutaPrevia(pathname);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-[var(--radius-admin-control)] p-2 text-left transition hover:bg-admin-bg"
      >
        {/* admin-green a propósito: la inicial del negocio es marca/avatar estático, no un elemento interactivo. */}
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-admin-control)] bg-admin-green text-sm font-bold text-white">
          {tenantInitial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-semibold text-admin-ink">{user.tenant.nombre}</span>
          <span className="truncate text-[13px] text-admin-ink-soft">
            {ROL_LABEL[user.rol]} · {user.nombre}
          </span>
        </span>
        <IconChevronDown size={16} className={`shrink-0 text-admin-ink-soft transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-[var(--radius-admin-card)] border border-admin-border bg-white shadow-lg"
        >
          <Link
            href="/dashboard/cambiar-password"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onCerrarDrawer?.();
            }}
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
    </div>
  );
}
