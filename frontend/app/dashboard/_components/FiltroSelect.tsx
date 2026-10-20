"use client";

// Contenido de popover genérico para un filtro de elección única: al tocar el chip se abre directo la lista de opciones y
// elegir una aplica el filtro al instante (sin select intermedio ni botón «Aplicar»). Compartido por Estado, Método de pago y
// Estado de pago; el enum y las etiquetas siguen siendo de cada módulo (se pasan por prop). Para quitar el filtro está la ✕ del chip.
export function FiltroSelectPopover<T extends string>({
  opciones,
  valorAplicado,
  onAplicar,
  close,
}: {
  opciones: { value: T; label: string }[];
  valorAplicado: T | null;
  onAplicar: (value: T | null) => void;
  close: () => void;
}) {
  return (
    <ul role="listbox" className="flex flex-col">
      {opciones.map((o) => {
        const activa = o.value === valorAplicado;
        return (
          <li key={o.value} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={activa}
              onClick={() => {
                onAplicar(o.value);
                close();
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-[var(--radius-admin-control)] px-3 py-1.5 text-left text-sm transition hover:bg-admin-bg ${
                activa ? "font-bold text-admin-accent-dark" : "text-admin-ink"
              }`}
            >
              {o.label}
              {activa && <span aria-hidden="true">✓</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
