"use client";

import { ReactNode, useEffect } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
}

// Replaces the "fixed inset-0 bg-black/40" confirmation-modal markup
// duplicated across catalogo/page.tsx (delete category), equipo/page.tsx
// (temporary password), puntos-envio-section.tsx (delete zone), etc. Not
// connected to any of those screens yet — created in this phase only, see
// CLAUDE.md phase notes.
export default function Modal({ open, onClose, title, children, footer }: ModalProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-sm flex-col gap-4 rounded-[var(--radius-admin-card)] bg-white p-6 shadow-[0_20px_50px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-extrabold text-admin-ink">{title}</h3>
        {children}
        {footer && <div className="flex gap-2">{footer}</div>}
      </div>
    </div>
  );
}
