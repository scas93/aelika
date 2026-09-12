"use client";

import { useState } from "react";
import { rangoRelativoISO, type UnidadRangoRelativo } from "@/lib/fecha";
import Button from "./Button";

// Contenido de popover compartido por las 3 tablas migradas — mismo campo
// (desde/hasta), mismo cálculo de rango relativo en las tres, así que sí se
// comparte (a diferencia de Estado/Método de pago, que cambian de enum y de
// etiqueta por módulo y se quedan cada uno en su propio archivo).
export type FiltroFechaValue =
  | { modo: "relativo"; cantidad: number; unidad: UnidadRangoRelativo }
  | { modo: "absoluto"; desde: string; hasta: string };

const UNIDAD_LABEL: Record<UnidadRangoRelativo, { singular: string; plural: string }> = {
  dias: { singular: "día", plural: "días" },
  semanas: { singular: "semana", plural: "semanas" },
  meses: { singular: "mes", plural: "meses" },
};

// Traduce el valor del filtro a desde/hasta ISO — el rango relativo se
// resuelve con rangoRelativoISO (lib/fecha.ts), la misma frontera de "hoy"
// que ya usan rangoHoyISO/rangoUltimos7DiasISO/etc. en los modales de
// exportar CSV. Nunca aritmética de Date propia aquí.
export function resolverFiltroFecha(value: FiltroFechaValue | null): { desde?: string; hasta?: string } {
  if (!value) return {};
  if (value.modo === "relativo") {
    return rangoRelativoISO(value.cantidad, value.unidad);
  }
  return {
    desde: value.desde ? new Date(value.desde).toISOString() : undefined,
    hasta: value.hasta ? new Date(`${value.hasta}T23:59:59.999`).toISOString() : undefined,
  };
}

export function labelFiltroFecha(value: FiltroFechaValue | null): string | null {
  if (!value) return null;
  if (value.modo === "relativo") {
    const { singular, plural } = UNIDAD_LABEL[value.unidad];
    return `últimos ${value.cantidad} ${value.cantidad === 1 ? singular : plural}`;
  }
  if (value.desde && value.hasta) return `${value.desde} – ${value.hasta}`;
  if (value.desde) return `desde ${value.desde}`;
  if (value.hasta) return `hasta ${value.hasta}`;
  return null;
}

export function FiltroFechaPopover({
  valorAplicado,
  onAplicar,
  close,
}: {
  valorAplicado: FiltroFechaValue | null;
  onAplicar: (value: FiltroFechaValue | null) => void;
  close: () => void;
}) {
  // Se inicializa desde `valorAplicado` una sola vez al montar — este
  // componente se desmonta al cerrar el popover sin aplicar (ver
  // Popover.tsx: `{open && children}`), así que la próxima vez que se abra
  // vuelve a montar limpio con el valor aplicado más reciente, sin rastro
  // del borrador anterior.
  const [modo, setModo] = useState<"relativo" | "absoluto">(valorAplicado?.modo ?? "relativo");
  const [cantidad, setCantidad] = useState(valorAplicado?.modo === "relativo" ? valorAplicado.cantidad : 7);
  const [unidad, setUnidad] = useState<UnidadRangoRelativo>(
    valorAplicado?.modo === "relativo" ? valorAplicado.unidad : "dias",
  );
  const [desde, setDesde] = useState(valorAplicado?.modo === "absoluto" ? valorAplicado.desde : "");
  const [hasta, setHasta] = useState(valorAplicado?.modo === "absoluto" ? valorAplicado.hasta : "");

  function handleAplicar() {
    if (modo === "relativo") {
      onAplicar({ modo: "relativo", cantidad, unidad });
    } else {
      onAplicar(desde || hasta ? { modo: "absoluto", desde, hasta } : null);
    }
    close();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 text-sm font-semibold">
        <button
          type="button"
          onClick={() => setModo("relativo")}
          className={modo === "relativo" ? "text-admin-accent-dark" : "text-admin-ink-soft"}
        >
          Relativo
        </button>
        <button
          type="button"
          onClick={() => setModo("absoluto")}
          className={modo === "absoluto" ? "text-admin-accent-dark" : "text-admin-ink-soft"}
        >
          Rango
        </button>
      </div>

      {modo === "relativo" ? (
        <div className="flex items-center gap-2 text-sm text-admin-ink">
          Está en los últimos
          <input
            type="number"
            min={1}
            value={cantidad}
            onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
            className="admin-input w-16"
          />
          <select value={unidad} onChange={(e) => setUnidad(e.target.value as UnidadRangoRelativo)} className="admin-input flex-1">
            <option value="dias">Días</option>
            <option value="semanas">Semanas</option>
            <option value="meses">Meses</option>
          </select>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm font-semibold text-admin-ink">
            Desde
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="admin-input" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-admin-ink">
            Hasta
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="admin-input" />
          </label>
        </div>
      )}

      <Button variant="primary" size="sm" onClick={handleAplicar} className="self-start">
        Aplicar
      </Button>
    </div>
  );
}
