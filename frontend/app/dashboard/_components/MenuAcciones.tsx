"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconDots } from "@tabler/icons-react";

export interface AccionMenu {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

// Menú «⋯» de acciones de una fila. El panel se pinta en un portal con posición fija: una tabla vive dentro de un contenedor con
// overflow (Card) y un menú absoluto se recortaría en las últimas filas. Se cierra al hacer clic afuera, con Escape o al hacer
// scroll/redimensionar (para no quedar flotando en un sitio viejo).
export default function MenuAcciones({ acciones, label = "Más acciones", icono, tamano = "tabla" }: { acciones: AccionMenu[]; label?: string; icono?: ReactNode; tamano?: "barra" | "tabla" }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const abierto = pos !== null;

  useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setPos(null);
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || botonRef.current?.contains(t)) return;
      cerrar();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cerrar();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", cerrar);
    window.addEventListener("scroll", cerrar, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", cerrar);
      window.removeEventListener("scroll", cerrar, true);
    };
  }, [abierto]);

  function alternar() {
    if (abierto) return setPos(null);
    const r = botonRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  }

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={alternar}
        className={`inline-flex ${tamano === "barra" ? "h-barra w-barra" : "h-tabla w-tabla"} shrink-0 items-center justify-center rounded-[var(--radius-admin-control)] border border-admin-border bg-white text-admin-ink transition hover:bg-admin-bg`}
      >
        {icono ?? <IconDots size={16} />}
      </button>
      {abierto &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, right: pos.right }}
            className="z-[60] min-w-[10rem] rounded-[var(--radius-admin-card)] border border-admin-border bg-white p-1 shadow-lg"
          >
            {acciones.map((a) => (
              <button
                key={a.label}
                type="button"
                role="menuitem"
                disabled={a.disabled}
                onClick={() => {
                  setPos(null);
                  a.onClick();
                }}
                className="flex w-full items-center gap-2 rounded-[var(--radius-admin-control)] px-3 py-1.5 text-left text-sm max-md:min-h-10 text-admin-ink transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40"
              >
                {a.icon}
                {a.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
