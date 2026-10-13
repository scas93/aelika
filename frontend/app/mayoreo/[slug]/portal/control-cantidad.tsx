"use client";

import CantidadInput, {
  cantidadNumero,
  type Cantidad,
} from "@/components/cantidad-input";

const PASO =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-mayoreo-border bg-mayoreo-card text-xl font-semibold leading-none text-mayoreo-ink transition active:opacity-80 disabled:opacity-40";

/**
 * Control de cantidad «− [número] +» del portal. Se puede escribir el número directamente; nunca baja de 0.
 * Mismo control en «Reparto por día» y «Modificar pedido».
 */
export default function ControlCantidad({
  value,
  onChange,
  etiqueta,
  etiquetaMenos,
  etiquetaMas,
}: {
  value: number;
  onChange: (cantidad: number) => void;
  /** Etiqueta accesible del campo numérico. */
  etiqueta: string;
  etiquetaMenos: string;
  etiquetaMas: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className={PASO}
        disabled={value <= 0}
        aria-label={etiquetaMenos}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        −
      </button>
      <CantidadInput
        value={value as Cantidad}
        onChange={(v) => onChange(cantidadNumero(v))}
        aria-label={etiqueta}
        className="mayoreo-input h-10 w-12 [appearance:textfield] px-1 text-center [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        className={PASO}
        aria-label={etiquetaMas}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}
