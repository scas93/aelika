import { etiquetaFechaCorta } from "@/lib/portal-calendario-formato";
import { dinero } from "../estilos";

// Bloques compartidos por el Resumen y la Confirmación de «Crear pedido», para que se vean exactamente igual.

/** Tarjeta de total: «Total», monto grande y, con descuento, subtotal tachado y píldora de ahorro. */
export function TarjetaTotal({
  total,
  subtotal,
  descuento,
  descuentoPorcentaje,
}: {
  total: number;
  subtotal: number;
  descuento: number;
  descuentoPorcentaje: number;
}) {
  const conDescuento = descuentoPorcentaje > 0 && descuento > 0;
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-mayoreo-card px-4 py-3 shadow-sm">
      <span className="text-xs font-medium text-mayoreo-ink-soft">Total</span>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-2xl font-bold leading-tight">
          {dinero(total)}
        </span>
        {conDescuento && (
          <span className="text-sm text-mayoreo-ink-soft/70 line-through">
            {dinero(subtotal)}
          </span>
        )}
      </div>
      {conDescuento && (
        <span className="mt-1.5 self-start rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
          Ahorras {dinero(descuento)} · {descuentoPorcentaje}% de descuento
        </span>
      )}
    </div>
  );
}

export interface LineaDia {
  clave: string;
  nombre: string;
  cantidad: number;
}

/** Un día de entrega: fecha en negritas, piezas del día a la derecha y productos (nombre a la izquierda, cantidad a la derecha). */
export function DiaEntrega({
  fecha,
  lineas,
  estado,
  onEditar,
}: {
  fecha: string;
  lineas: LineaDia[];
  /** Si se manda, junto a las piezas aparece «Editar» (el resumen de «Crear pedido» vuelve a ese día). */
  onEditar?: () => void;
  /** Estado de la entrega (Pendiente, Entregada…) como píldora pequeña junto a la fecha. */
  estado?: { codigo: string; etiqueta: string };
}) {
  const piezas = lineas.reduce((s, l) => s + l.cantidad, 0);
  return (
    <div className="flex flex-col gap-2 border-t border-mayoreo-border pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-sm font-bold">{etiquetaFechaCorta(fecha)}</span>
          {estado && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                estado.codigo === "CANCELADA"
                  ? "bg-red-50 text-red-700"
                  : estado.codigo === "ENTREGADA"
                    ? "bg-green-50 text-green-800"
                    : "bg-mayoreo-accent-soft text-mayoreo-ink"
              }`}
            >
              {estado.etiqueta}
            </span>
          )}
        </span>
        <span className="flex items-baseline gap-3 text-sm text-mayoreo-ink-soft">
          {piezas} pzas
          {onEditar && (
            <button
              type="button"
              className="font-semibold text-mayoreo-ink underline"
              aria-label={`Editar ${etiquetaFechaCorta(fecha)}`}
              onClick={onEditar}
            >
              Editar
            </button>
          )}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {lineas.map((l) => (
          <li
            key={l.clave}
            className="flex items-baseline justify-between gap-3 text-sm text-mayoreo-ink-soft"
          >
            <span className="min-w-0">{l.nombre}</span>
            <span className="shrink-0 tabular-nums">{l.cantidad}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** «Recoge en» con ícono de ubicación: dirección del negocio y, si se manda, la hora. Sin dirección no se muestra nada. */
export function BloqueRecoge({
  direccion,
  hora,
  className = "",
}: {
  direccion: string | null;
  hora?: string;
  className?: string;
}) {
  const texto = direccion?.trim();
  if (!texto) return null;
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <svg
        viewBox="0 0 24 24"
        className="mt-0.5 h-5 w-5 shrink-0 text-mayoreo-ink-soft"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
      <div className="flex flex-col">
        <span className="text-xs font-medium text-mayoreo-ink-soft">
          Recoge en
        </span>
        <span className="text-sm">
          {texto}
          {hora ? ` · ${hora}` : ""}
        </span>
      </div>
    </div>
  );
}
