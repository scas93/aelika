"use client";

import { IconDownload } from "@tabler/icons-react";

// Exportar: botón chico, cuadrado y de solo ícono, en la fila del título (a la derecha), con tooltip («Exportar Excel» / «Exportar CSV»).
export default function BotonExportar({
  label,
  onClick,
  disabled = false,
  cargando = false,
  grande = false,
}: {
  label: "Exportar Excel" | "Exportar CSV";
  onClick: () => void;
  disabled?: boolean;
  cargando?: boolean;
  /** En la barra del buscador: misma altura que el buscador (44 px). */
  grande?: boolean;
}) {
  return (
    <button
      type="button"
      title={cargando ? "Exportando..." : label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled || cargando}
      className={`inline-flex ${grande ? "h-barra w-barra" : "h-tabla w-tabla"} shrink-0 items-center justify-center rounded-[var(--radius-admin-control)] border border-admin-border bg-white text-admin-ink transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <IconDownload size={grande ? 18 : 16} className={cargando ? "animate-pulse" : ""} />
    </button>
  );
}
