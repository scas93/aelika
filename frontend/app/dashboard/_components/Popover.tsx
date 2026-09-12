"use client";

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
}

// Generaliza el mecanismo que ya probó UserMenu.tsx (abre/cierra,
// click-outside, cierre en cambio de ruta) para anclar cualquier trigger —
// primer consumidor real más allá de un solo caso fijo (FilterBar, con ~6
// tipos de filtro × 3 módulos), así que a diferencia de la vez anterior sí
// se justifica extraerlo. A diferencia de UserMenu (una sola posición fija
// en la esquina/fondo del sidebar), este necesita decidir su alineación
// izquierda/derecha según el trigger — un pill al final de una fila puede
// no tener espacio a la derecha. Controlado (open/onClose vienen del
// caller) en vez de manejar su propio estado — así quien lo use (FilterBar)
// puede garantizar que solo un Popover esté abierto a la vez con un solo
// estado compartido, sin coordinación extra entre instancias.
export default function Popover({ open, onClose, trigger, children }: PopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [align, setAlign] = useState<"left" | "right">("left");

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Cierra en cada cambio de ruta — mismo criterio que UserMenu/DashboardNav.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Alineación izquierda por default; si al abrir se sale del viewport por
  // la derecha, se voltea a alineado-a-la-derecha del trigger. Se mide
  // después de montar (useLayoutEffect, antes del primer paint) para que no
  // haya parpadeo visible en el caso común que sí necesita voltearse.
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    setAlign(rect.right > window.innerWidth ? "right" : "left");
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      {trigger}
      {open && (
        <div
          ref={panelRef}
          className={`absolute top-full z-50 mt-2 w-72 rounded-[var(--radius-admin-card)] border border-admin-border bg-white p-4 shadow-lg ${
            align === "left" ? "left-0" : "right-0"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
