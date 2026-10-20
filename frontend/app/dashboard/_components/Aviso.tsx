"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { IconAlertCircle, IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";

// Aviso de una línea, estilo único: fondo suave, sin borde marcado, ícono a la izquierda, texto y acción como enlace a la derecha
// («Ver»), y ✕ solo si se puede descartar. Tono por significado: ámbar = requiere acción, rojo = cancelaciones o errores,
// neutro = informativo.
export type TonoAviso = "ambar" | "rojo" | "neutro";

const TONO: Record<TonoAviso, { caja: string; icono: ReactNode }> = {
  ambar: { caja: "bg-amber-50 text-amber-900", icono: <IconAlertTriangle size={16} className="text-amber-600" /> },
  rojo: { caja: "bg-red-50 text-red-900", icono: <IconAlertCircle size={16} className="text-red-600" /> },
  neutro: { caja: "bg-gray-100 text-admin-ink", icono: <IconInfoCircle size={16} className="text-admin-ink-soft" /> },
};

export default function Aviso({
  tono = "neutro",
  children,
  accion,
  onDescartar,
  ariaLabel,
}: {
  tono?: TonoAviso;
  children: ReactNode;
  accion?: { label: string; onClick?: () => void; href?: string; disabled?: boolean };
  onDescartar?: () => void;
  ariaLabel?: string;
}) {
  const t = TONO[tono];
  const claseAccion = "shrink-0 text-sm font-semibold text-admin-accent-dark underline-offset-2 hover:underline disabled:opacity-50";
  return (
    <div role={tono === "neutro" ? "status" : "alert"} aria-label={ariaLabel} className={`flex items-center gap-2 rounded-[var(--radius-admin-control)] px-3 py-2 text-sm ${t.caja}`}>
      <span className="shrink-0">{t.icono}</span>
      <div className="min-w-0 flex-1 font-medium">{children}</div>
      {accion &&
        (accion.href ? (
          <Link href={accion.href} className={claseAccion}>
            {accion.label}
          </Link>
        ) : (
          <button type="button" onClick={accion.onClick} disabled={accion.disabled} className={claseAccion}>
            {accion.label}
          </button>
        ))}
      {onDescartar && (
        <button type="button" onClick={onDescartar} aria-label="Descartar aviso" className="shrink-0 leading-none text-admin-ink-soft hover:text-admin-ink">
          ✕
        </button>
      )}
    </div>
  );
}
