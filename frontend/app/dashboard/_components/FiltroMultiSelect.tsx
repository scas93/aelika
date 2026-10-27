"use client";

// Filtro de SELECCIÓN MÚLTIPLE (Estado y Pago de Pedidos B2B). Contenido de popover: cada toque marca o desmarca una opción SIN
// cerrar el panel (se cierra al tocar fuera, lo hace el contenedor); «Limpiar» deja el filtro vacío. Dentro del filtro las
// opciones se combinan con O; sin nada marcado = todos. El de elección única (FiltroSelect) se conserva tal cual para el resto.
export function FiltroMultiSelectPopover<T extends string>({
  opciones,
  valoresAplicados,
  onAplicar,
}: {
  opciones: { value: T; label: string }[];
  valoresAplicados: T[];
  onAplicar: (values: T[]) => void;
}) {
  function alternar(value: T) {
    const marcado = valoresAplicados.includes(value);
    // Se conserva el orden de las opciones, no el orden en que se marcaron.
    onAplicar(opciones.map((o) => o.value).filter((v) => (v === value ? !marcado : valoresAplicados.includes(v))));
  }

  return (
    <div className="flex flex-col">
      <ul role="listbox" aria-multiselectable="true" className="flex flex-col">
        {opciones.map((o) => {
          const activa = valoresAplicados.includes(o.value);
          return (
            <li key={o.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={activa}
                onClick={() => alternar(o.value)}
                className={`flex h-tabla w-full items-center gap-2 rounded-[var(--radius-admin-control)] px-3 text-left text-sm transition hover:bg-admin-bg ${
                  activa ? "font-bold text-admin-accent-dark" : "text-admin-ink"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${
                    activa ? "border-admin-accent-dark bg-admin-accent-dark text-white" : "border-admin-border bg-white"
                  }`}
                >
                  {activa ? "✓" : ""}
                </span>
                {o.label}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => onAplicar([])}
        disabled={valoresAplicados.length === 0}
        className="mt-1 h-tabla self-start rounded-[var(--radius-admin-control)] px-3 text-sm font-semibold text-admin-accent-dark transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40"
      >
        Limpiar
      </button>
    </div>
  );
}

/** Texto del chip: nada marcado → null (sin chip); 1 → su nombre; 2 → ambos nombres; 3 o más → «N seleccionados». */
export function labelMultiSelect<T extends string>(seleccion: T[], etiqueta: (value: T) => string): string | null {
  if (seleccion.length === 0) return null;
  if (seleccion.length <= 2) return seleccion.map(etiqueta).join(", ");
  return `${seleccion.length} seleccionados`;
}
