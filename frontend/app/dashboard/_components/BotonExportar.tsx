"use client";

import { IconDownload } from "@tabler/icons-react";

// Exportar: botón chico, cuadrado y de solo ícono, en la fila del título (a la derecha), con tooltip («Exportar Excel» / «Exportar CSV»).
export default function BotonExportar({
  label,
  onClick,
  disabled = false,
  cargando = false,
}: {
  label: "Exportar Excel" | "Exportar CSV";
  onClick: () => void;
  disabled?: boolean;
  cargando?: boolean;
}) {
  return (
    <button
      type="button"
      title={cargando ? "Exportando..." : label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled || cargando}
      className="inline-flex h-8 w-8 max-md:h-10 max-md:w-10 items-center justify-center rounded-[var(--radius-admin-control)] border border-admin-border bg-white text-admin-ink transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40"
    >
      <IconDownload size={16} className={cargando ? "animate-pulse" : ""} />
    </button>
  );
}
