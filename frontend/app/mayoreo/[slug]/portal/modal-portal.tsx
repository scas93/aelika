"use client";

import { useEffect, type ReactNode } from "react";

// Ventana pequeña centrada del portal: fondo que no deja tocar lo de abajo, Escape cierra y se cierra tocando fuera.
export default function ModalPortal({
  titulo,
  onCerrar,
  children,
}: {
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-mayoreo-card p-5 text-mayoreo-ink shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}
