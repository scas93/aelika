"use client";

import type { ModalidadPagoB2b } from "@/lib/api";
import { AVISO_ACTIVAR_MODALIDAD, MODALIDADES_COBRO, MODALIDAD_LABEL } from "@/lib/modalidades-cobro";

/**
 * Selector de la modalidad de pago de un cliente B2B (alta y ficha). Obligatorio: sin «Igual que el negocio». Las
 * modalidades que el negocio no tiene activas se ven deshabilitadas con «Actívala en Ajustes → Pagos».
 */
export default function SelectorModalidadPago({
  value,
  onChange,
  activas,
  error,
}: {
  value: "" | ModalidadPagoB2b;
  onChange: (valor: "" | ModalidadPagoB2b) => void;
  activas: ModalidadPagoB2b[];
  error?: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-admin-ink">
      Modalidad de pago
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as "" | ModalidadPagoB2b)}
        className={`admin-input w-full min-w-0 ${error ? "border-red-500!" : ""}`}
        aria-invalid={!!error}
      >
        <option value="" disabled>
          Elige una modalidad
        </option>
        {MODALIDADES_COBRO.map((m) => (
          <option key={m} value={m} disabled={!activas.includes(m)}>
            {MODALIDAD_LABEL[m]}
            {activas.includes(m) ? "" : ` — ${AVISO_ACTIVAR_MODALIDAD}`}
          </option>
        ))}
      </select>
      {error && <span className="text-xs font-normal text-red-600">{error}</span>}
    </label>
  );
}
