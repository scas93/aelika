"use client";

import { useState } from "react";
import type { FiltroImporte, FiltroImporteOperador } from "@/lib/api";
import Button from "./Button";

// Contenido de popover compartido por las 3 tablas — mismo comparador
// (operador/valor/valorHasta) exactamente igual en los 3 endpoints backend
// (ver backend/src/common/filtro-importe.ts), así que un solo componente
// basta.
const OPERADOR_LABEL: Record<FiltroImporteOperador, string> = {
  IGUAL: "Es igual a",
  MAYOR_IGUAL: "Es mayor o igual a",
  MENOR_IGUAL: "Es menor o igual a",
  ENTRE: "Está entre",
};

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

export function FiltroImportePopover({
  valorAplicado,
  onAplicar,
  close,
}: {
  valorAplicado: FiltroImporte | null;
  onAplicar: (value: FiltroImporte | null) => void;
  close: () => void;
}) {
  const [operador, setOperador] = useState<FiltroImporteOperador>(valorAplicado?.operador ?? "MAYOR_IGUAL");
  const [valor, setValor] = useState(valorAplicado?.valor?.toString() ?? "");
  const [valorHasta, setValorHasta] = useState(valorAplicado?.valorHasta?.toString() ?? "");

  const valorNum = Number(valor);
  const valorHastaNum = Number(valorHasta);
  const puedeAplicar =
    valor !== "" &&
    !Number.isNaN(valorNum) &&
    (operador !== "ENTRE" || (valorHasta !== "" && !Number.isNaN(valorHastaNum)));

  function handleAplicar() {
    if (valor === "" || Number.isNaN(valorNum)) {
      onAplicar(null);
    } else if (operador === "ENTRE") {
      onAplicar(valorHasta !== "" && !Number.isNaN(valorHastaNum) ? { operador, valor: valorNum, valorHasta: valorHastaNum } : null);
    } else {
      onAplicar({ operador, valor: valorNum });
    }
    close();
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-semibold text-admin-ink">
        Comparador
        <select value={operador} onChange={(e) => setOperador(e.target.value as FiltroImporteOperador)} className="admin-input">
          {(Object.keys(OPERADOR_LABEL) as FiltroImporteOperador[]).map((op) => (
            <option key={op} value={op}>
              {OPERADOR_LABEL[op]}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm font-semibold text-admin-ink">
          {operador === "ENTRE" ? "Desde" : "Valor"}
          <input
            type="number"
            step="0.01"
            min={0}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="admin-input"
          />
        </label>
        {operador === "ENTRE" && (
          <label className="flex flex-1 flex-col gap-1 text-sm font-semibold text-admin-ink">
            Hasta
            <input
              type="number"
              step="0.01"
              min={0}
              value={valorHasta}
              onChange={(e) => setValorHasta(e.target.value)}
              className="admin-input"
            />
          </label>
        )}
      </div>

      <Button variant="primary" size="sm" onClick={handleAplicar} disabled={!puedeAplicar} className="self-start">
        Aplicar
      </Button>
    </div>
  );
}
