"use client";

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
}

const MARGEN = 8; // separación mínima con el borde de la ventana
const SEPARACION = 8; // entre el trigger y el panel

// Panel anclado a un trigger. Controlado (open/onClose vienen del caller): así quien lo use puede garantizar que solo un Popover esté
// abierto a la vez con un solo estado compartido.
//
// El panel se pinta en un PORTAL con posición fija (igual que MenuAcciones), no como hijo absoluto del trigger. Motivos:
//  - Un panel absoluto dentro de la barra cuenta como desborde de la fila (`scrollWidth`) y la barra lo confundía con falta de
//    espacio: escondía «Filtros» y exportar en el «⋯» con la ventana ancha. En el portal no afecta a ningún contenedor.
//  - Fijo y limitado a la ventana: nunca se sale por el borde, nunca agranda el documento (sin scroll horizontal ni corrimiento).
// La posición se calcula NEUTRA en cada apertura y en cada cambio de ventana, scroll o contenido (nunca depende de la apertura
// anterior; al abrir se vuelve a medir antes del primer paint): alineado al borde izquierdo del trigger y, si no cabe, al derecho; después se ajusta para quedar dentro de la ventana.
export default function Popover({ open, onClose, trigger, children }: PopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Lado al que se ancla el panel. Se decide UNA vez por apertura (con la medida neutra al abrir) y no cambia mientras está abierto:
  // si el trigger se mueve (p. ej. le aparece el contador al botón «Filtros»), el panel lo sigue sin saltar de un lado a otro.
  const lado = useRef<"izquierda" | "derecha" | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onClose();
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

  // Cierra en cada cambio de ruta — mismo criterio que UserMenu/DashboardNav. Solo cuando la ruta cambia de verdad: al montarse (p. ej.
  // cuando la barra se compacta y el panel pasa de colgar del botón «Filtros» a colgar del «⋯») NO debe cerrarse.
  const rutaAnterior = useRef(pathname);
  useEffect(() => {
    if (rutaAnterior.current === pathname) return;
    rutaAnterior.current = pathname;
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function calcular() {
    const contenedor = containerRef.current;
    const panel = panelRef.current;
    if (!contenedor || !panel) return;
    const t = contenedor.getBoundingClientRect();
    const ancho = panel.offsetWidth;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = document.documentElement.clientHeight || window.innerHeight;
    // Alineado al borde izquierdo del trigger; si no cabe, al derecho.
    lado.current ??= t.left + ancho > vw - MARGEN ? "derecha" : "izquierda";
    let left = lado.current === "izquierda" ? t.left : t.right - ancho;
    left = Math.max(MARGEN, Math.min(left, vw - ancho - MARGEN));
    const top = t.bottom + SEPARACION;
    const maxHeight = Math.max(120, vh - top - MARGEN);
    setPos((p) => (p && p.left === left && p.top === top && p.maxHeight === maxHeight ? p : { top, left, maxHeight }));
  }

  // Antes del primer paint al abrir (sin parpadeo) y tras cada render mientras está abierto: si la barra se reacomoda (p. ej. el
  // contador del botón «Filtros») o el panel cambia de tamaño (se abre una sección), el panel sigue a su trigger.
  useLayoutEffect(() => {
    if (open) calcular();
  });

  // Al cerrar se olvida el lado: la próxima apertura se decide desde cero (nunca depende de la anterior).
  useEffect(() => {
    if (!open) lado.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", calcular);
    window.addEventListener("scroll", calcular, true);
    return () => {
      window.removeEventListener("resize", calcular);
      window.removeEventListener("scroll", calcular, true);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      {trigger}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              maxHeight: pos?.maxHeight,
              visibility: pos ? "visible" : "hidden",
            }}
            className="z-50 w-max min-w-[10rem] max-w-[min(20rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-[var(--radius-admin-card)] border border-admin-border bg-white p-4 shadow-lg"
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
