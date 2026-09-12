"use client";

import { createContext, ReactNode, useContext, useState } from "react";
import Popover from "./Popover";

interface PopoverCoordinator {
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
}

// Un solo estado (openKey) compartido por todos los FilterPill de una
// FilterBar — abrir un pill (setOpenKey a su propia key) cierra
// automáticamente cualquier otro que estuviera abierto, sin necesitar
// coordinación explícita entre instancias.
const PopoverCoordinatorContext = createContext<PopoverCoordinator | null>(null);

export function FilterBar({ children }: { children: ReactNode }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <PopoverCoordinatorContext.Provider value={{ openKey, setOpenKey }}>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </PopoverCoordinatorContext.Provider>
  );
}

interface FilterPillProps {
  // Única dentro de la FilterBar que lo contiene — decide qué pill está
  // "abierto" en el estado compartido de arriba.
  filterKey: string;
  label: string;
  // null = todavía no hay filtro aplicado, el pill muestra "+ {label}".
  // Presente = el pill muestra "{label}: {valueLabel}" + una "×" para
  // quitar el filtro sin abrir el popover.
  valueLabel: string | null;
  onClear: () => void;
  // El contenido del popover recibe `close` para llamarlo después de
  // "Aplicar" (confirma el borrador). Si el popover se cierra de cualquier
  // otra forma (click afuera, Escape, cambio de ruta — ver Popover.tsx) sin
  // que el contenido haya llamado `close` desde su botón Aplicar, el
  // borrador nunca se confirmó: el contenido de cada filtro se encarga de
  // inicializar su propio estado de borrador a partir del valor aplicado
  // cada vez que se abre, así que un cierre sin aplicar simplemente no dejó
  // ningún rastro para la próxima vez que se abra.
  children: (props: { close: () => void }) => ReactNode;
}

export function FilterPill({ filterKey, label, valueLabel, onClear, children }: FilterPillProps) {
  const coordinator = useContext(PopoverCoordinatorContext);
  if (!coordinator) {
    throw new Error("FilterPill debe usarse dentro de FilterBar");
  }
  const { openKey, setOpenKey } = coordinator;
  const open = openKey === filterKey;
  const aplicado = valueLabel !== null;

  return (
    <Popover
      open={open}
      onClose={() => setOpenKey(null)}
      trigger={
        aplicado ? (
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-admin-pill)] border border-admin-accent bg-admin-accent-soft py-1.5 pl-3 pr-2 text-sm font-semibold text-admin-accent-dark">
            <button type="button" onClick={() => setOpenKey(filterKey)}>
              {label}: {valueLabel}
            </button>
            <button
              type="button"
              onClick={onClear}
              aria-label={`Quitar filtro de ${label}`}
              className="leading-none text-admin-accent-dark/70 hover:text-admin-accent-dark"
            >
              ×
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOpenKey(filterKey)}
            className="rounded-[var(--radius-admin-pill)] border border-dashed border-admin-border bg-white px-3 py-1.5 text-sm font-semibold text-admin-ink-soft transition hover:bg-admin-bg"
          >
            + {label}
          </button>
        )
      }
    >
      {children({ close: () => setOpenKey(null) })}
    </Popover>
  );
}
