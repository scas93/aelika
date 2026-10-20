"use client";

import { useRef, useState } from "react";
import type { FiltroImporte, FiltroImporteOperador } from "@/lib/api";

// Contenido de popover compartido por las 3 tablas — mismo comparador
// (operador/valor/valorHasta) exactamente igual en los 3 endpoints backend
// (ver backend/src/common/filtro-importe.ts), así que un solo componente
// basta.
const OPERADOR_SIMBOLO: Record<FiltroImporteOperador, string> = {
  IGUAL: "=",
  MAYOR_IGUAL: "≥",
  MENOR_IGUAL: "≤",
  ENTRE: "entre",
};

export function labelFiltroImporte(value: FiltroImporte | null): string | null {
  if (!value?.operador || value.valor === undefined) return null;
  if (value.operador === "ENTRE") {
    return `${OPERADOR_SIMBOLO.ENTRE} $${value.valor.toFixed(2)} y $${(value.valorHasta ?? value.valor).toFixed(2)}`;
  }
  return `${OPERADOR_SIMBOLO[value.operador]} $${value.valor.toFixed(2)}`;
}

// Dos campos (mínimo y máximo) que aplican al presionar Enter o al salir del campo. Con los dos se filtra «entre», con solo uno
// «≥ mínimo» o «≤ máximo»; ambos vacíos quitan el filtro.
function numero(texto: string): number | null | undefined {
  if (texto.trim() === "") return undefined; // vacío
  const n = Number(texto);
  return Number.isFinite(n) && n >= 0 ? n : null; // null = inválido
}

function construirFiltro(min: string, max: string): FiltroImporte | null | "invalido" {
  const a = numero(min);
  const b = numero(max);
  if (a === null || b === null) return "invalido";
  if (a !== undefined && b !== undefined) return a > b ? "invalido" : { operador: "ENTRE", valor: a, valorHasta: b };
  if (a !== undefined) return { operador: "MAYOR_IGUAL", valor: a };
  if (b !== undefined) return { operador: "MENOR_IGUAL", valor: b };
  return null;
}

export function FiltroImportePopover({
  valorAplicado,
  onAplicar,
  close,
}: {
  valorAplicado: FiltroImporte | null;
  onAplicar: (value: FiltroImporte | null) => void;
  close: () => void;
}) {
  const op = valorAplicado?.operador;
  const valor = valorAplicado?.valor;
  const [min, setMin] = useState(valor === undefined ? "" : op === "MENOR_IGUAL" ? "" : String(valor));
  const [max, setMax] = useState(
    valor === undefined ? "" : op === "ENTRE" ? String(valorAplicado?.valorHasta ?? valor) : op === "MENOR_IGUAL" || op === "IGUAL" ? String(valor) : "",
  );
  const [error, setError] = useState<string | null>(null);
  // Evita aplicar dos veces el mismo valor (p. ej. Enter y luego blur).
  const ultimo = useRef(JSON.stringify(valorAplicado ?? null));

  function aplicar(minTexto: string, maxTexto: string): boolean {
    const filtro = construirFiltro(minTexto, maxTexto);
    if (filtro === "invalido") {
      setError(numero(minTexto) !== null && numero(maxTexto) !== null ? "El mínimo no puede ser mayor que el máximo" : "Escribe un monto válido");
      return false;
    }
    setError(null);
    const clave = JSON.stringify(filtro);
    if (clave !== ultimo.current) {
      ultimo.current = clave;
      onAplicar(filtro);
    }
    return true;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (aplicar(min, max)) close();
  }

  const campo = "admin-input w-full";
  return (
    <div className="flex w-56 flex-col gap-2">
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm font-semibold text-admin-ink">
          Mínimo
          <input
            type="number"
            step="0.01"
            min={0}
            inputMode="decimal"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            onBlur={() => aplicar(min, max)}
            onKeyDown={onKeyDown}
            placeholder="$0"
            className={campo}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm font-semibold text-admin-ink">
          Máximo
          <input
            type="number"
            step="0.01"
            min={0}
            inputMode="decimal"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            onBlur={() => aplicar(min, max)}
            onKeyDown={onKeyDown}
            placeholder="Sin tope"
            className={campo}
          />
        </label>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
