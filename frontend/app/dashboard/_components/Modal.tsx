"use client";

import { ReactNode, useEffect } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  // Formularios con varias columnas (ej. alta de un cliente): más ancho que el diálogo de confirmación por defecto.
  // true = ancho de formulario (max-w-xl); "xl" = tablas de varias columnas (max-w-3xl).
  wide?: boolean | "xl";
}

// Replaces the "fixed inset-0 bg-black/40" confirmation-modal markup
// duplicated across catalogo/page.tsx (delete category), equipo/page.tsx
// (temporary password), puntos-envio-section.tsx (delete zone), etc. Not
// connected to any of those screens yet — created in this phase only, see
// CLAUDE.md phase notes.
export default function Modal({ open, onClose, title, children, footer, wide = false }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // Teléfono: pantalla completa, con su ✕ arriba y las acciones fijas abajo, a lo ancho.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 max-md:p-0" onClick={onClose}>
      <div
        className={`flex w-full ${wide === "xl" ? "max-w-3xl" : wide ? "max-w-xl" : "max-w-sm"} flex-col gap-4 rounded-[var(--radius-admin-card)] bg-white p-6 shadow-[0_20px_50px_rgba(0,0,0,0.3)] max-md:h-full max-md:max-w-none max-md:rounded-none max-md:p-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-extrabold text-admin-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-1 -mt-1 flex h-tabla w-tabla shrink-0 items-center justify-center text-xl leading-none text-admin-ink-soft transition hover:text-admin-ink md:hidden"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-4 max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto">{children}</div>
        {footer && <div className="flex gap-2 max-md:flex-col-reverse max-md:[&>button]:w-full">{footer}</div>}
      </div>
    </div>
  );
}
