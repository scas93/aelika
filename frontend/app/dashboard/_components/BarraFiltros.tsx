"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { IconChevronDown, IconFilter, IconSearch } from "@tabler/icons-react";
import { useEsMovil } from "@/lib/use-es-movil";
import Popover from "./Popover";
import BotonExportar from "./BotonExportar";

// Una sola barra de búsqueda y filtros para todo el panel: buscador ancho con lupa que busca mientras escribes (sin botón
// «Buscar») y, si la pantalla tiene filtros, un botón «Filtros» que abre un panel con todos. Los filtros activos se ven como chips
// con su valor y ✕ debajo de la barra, con «Limpiar filtros». Cada filtro conserva su comportamiento: listas que aplican al elegir,
// Total con mínimo/máximo, fecha o semana con calendario desde/hasta.
export interface FiltroDef {
  key: string;
  label: string;
  // null = sin filtro aplicado
  valueLabel: string | null;
  onClear: () => void;
  // El contenido recibe `cerrar` (pliega su sección) para llamarlo después de aplicar.
  render: (p: { cerrar: () => void }) => ReactNode;
}

const ESPERA_MS = 300;

export default function BarraBusqueda({
  placeholder,
  onBuscar,
  filtros = [],
  exportar,
}: {
  /** Sin placeholder/onBuscar la pantalla no tiene buscador (solo «Filtros»). */
  placeholder?: string;
  onBuscar?: (texto: string) => void;
  filtros?: FiltroDef[];
  /** Exportar: botón cuadrado de solo ícono a la derecha de «Filtros». En teléfono va en el menú «⋯» del título, no aquí. */
  exportar?: { label: "Exportar Excel" | "Exportar CSV"; onClick: () => void; disabled?: boolean; cargando?: boolean };
}) {
  const movil = useEsMovil();
  const [texto, setTexto] = useState("");
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [seccion, setSeccion] = useState<string | null>(null);
  const primera = useRef(true);

  // Busca mientras escribes, con una pequeña espera. La primera ejecución (montaje) no dispara nada.
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    const t = setTimeout(() => onBuscar?.(texto.trim()), ESPERA_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const activos = filtros.filter((f) => f.valueLabel !== null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {onBuscar && (
          <div className="relative min-w-0 flex-1">
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-admin-ink-soft" />
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder ?? "Buscar"}
              className="admin-input h-11 w-full py-0! pl-9!"
            />
          </div>
        )}
        {filtros.length > 0 && (
          <Popover
            open={panelAbierto}
            onClose={() => {
              setPanelAbierto(false);
              setSeccion(null);
            }}
            trigger={
              <button
                type="button"
                onClick={() => setPanelAbierto((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={panelAbierto}
                className="inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-admin-control)] border border-admin-border bg-white px-3 text-sm font-semibold text-admin-ink transition hover:bg-admin-bg"
              >
                <IconFilter size={16} className="shrink-0" />
                Filtros
                {activos.length > 0 && (
                  <span className="rounded-full bg-admin-accent px-1.5 text-xs font-bold leading-4 text-white">{activos.length}</span>
                )}
              </button>
            }
          >
            <div className="-m-1 flex w-72 flex-col">
              {filtros.map((f) => {
                const abierta = seccion === f.key;
                return (
                  <div key={f.key} className="border-b border-admin-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setSeccion(abierta ? null : f.key)}
                      aria-expanded={abierta}
                      className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-sm font-semibold text-admin-ink"
                    >
                      <span>{f.label}</span>
                      <span className="flex min-w-0 items-center gap-1.5 font-normal text-admin-ink-soft">
                        <span className="truncate">{f.valueLabel ?? ""}</span>
                        <IconChevronDown size={14} className={`shrink-0 transition-transform ${abierta ? "rotate-180" : ""}`} />
                      </span>
                    </button>
                    {abierta && <div className="px-1 pb-3">{f.render({ cerrar: () => setSeccion(null) })}</div>}
                  </div>
                );
              })}
            </div>
          </Popover>
        )}
        {exportar && !movil && <BotonExportar grande {...exportar} />}
      </div>

      {activos.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {activos.map((f) => (
            <span
              key={f.key}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-admin-pill)] border border-admin-accent bg-admin-accent-soft py-1 pl-3 pr-2 text-sm font-semibold text-admin-accent-dark"
            >
              {f.label}: {f.valueLabel}
              <button
                type="button"
                onClick={f.onClear}
                aria-label={`Quitar filtro de ${f.label}`}
                className="leading-none text-admin-accent-dark/70 hover:text-admin-accent-dark"
              >
                ✕
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => activos.forEach((f) => f.onClear())}
            className="text-sm font-semibold text-admin-accent hover:underline"
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );
}
