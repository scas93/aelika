"use client";

import { useEffect, useRef } from "react";

// Selector tipo "rueda" (como el de horas/minutos de iOS) para el paso de entrega del checkout. Dos columnas
// (horas y minutos) con scroll-snap: lo que queda en la banda del centro es lo seleccionado. También se puede tocar
// un valor para elegirlo. El valor es un total de minutos: duración ("en 1 h 15 min") o minutos del día ("13:30").

const ALTO_FILA = 40;
const FILAS_DURACION = 5;
const FILAS_RELOJ = 3;

export function aMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** "13:30" → "1:30 p. m." (formato que se usa al hablar de horas de entrega en México). */
export function formato12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a. m." : "p. m."}`;
}

export function deMinutos(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

interface ItemRueda {
  valor: number;
  etiqueta: string;
}

function Columna({
  items,
  valor,
  unidad,
  onChange,
  etiquetaAria,
  filas,
}: {
  items: ItemRueda[];
  valor: number;
  unidad?: string;
  onChange: (valor: number) => void;
  etiquetaAria: string;
  filas: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const indice = Math.max(
    0,
    items.findIndex((i) => i.valor === valor),
  );

  // Mantiene la rueda alineada con el valor (preselección y cambios que vienen de fuera, ej. al cambiar de hora).
  useEffect(() => {
    const el = ref.current;
    if (el && Math.abs(el.scrollTop - indice * ALTO_FILA) > 1) {
      el.scrollTo({ top: indice * ALTO_FILA });
    }
  }, [indice, items.length]);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  function alScrollear() {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ALTO_FILA)));
      if (items[i] && items[i].valor !== valor) onChange(items[i].valor);
    }, 90);
  }

  const relleno = ((filas - 1) / 2) * ALTO_FILA;

  return (
    <div
      ref={ref}
      onScroll={alScrollear}
      role="listbox"
      aria-label={etiquetaAria}
      className="snap-y snap-mandatory overflow-y-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{
        height: ALTO_FILA * filas,
        paddingBlock: relleno,
        maskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
      }}
    >
      {items.map((item, i) => {
        const activo = i === indice;
        return (
          <button
            key={item.valor}
            type="button"
            role="option"
            aria-selected={activo}
            onClick={() => {
              ref.current?.scrollTo({ top: i * ALTO_FILA, behavior: "smooth" });
              onChange(item.valor);
            }}
            className={`flex w-full snap-center items-center justify-center gap-1.5 whitespace-nowrap ${
              activo ? "font-semibold text-black dark:text-white" : "font-normal text-black/40 dark:text-white/40"
            }`}
            style={{ height: ALTO_FILA }}
          >
            <span className={activo ? "text-xl" : "text-lg"}>{item.etiqueta}</span>
            {activo && unidad && <span className="text-sm">{unidad}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * `opciones`: totales de minutos válidos, ordenados. modo "duracion": "0 h | 15 min" (pasos de lo que traiga la
 * lista); modo "reloj": "13 : 30". Al cambiar de hora, el minuto se ajusta al válido más cercano de esa hora.
 */
export default function RuedaHoraMin({
  opciones,
  valor,
  onChange,
  modo,
}: {
  opciones: number[];
  valor: number;
  onChange: (total: number) => void;
  modo: "duracion" | "reloj";
}) {
  const horas = Array.from(new Set(opciones.map((t) => Math.floor(t / 60))));
  const horaSel = Math.floor(valor / 60);
  const minutos = opciones.filter((t) => Math.floor(t / 60) === horaSel).map((t) => t % 60);

  function cambiarHora(h: number) {
    const delasHora = opciones.filter((t) => Math.floor(t / 60) === h);
    const minutoActual = valor % 60;
    onChange(delasHora.find((t) => t % 60 >= minutoActual) ?? delasHora[delasHora.length - 1]);
  }

  const etiquetaHora = (h: number) =>
    modo === "reloj" ? `${h % 12 || 12} ${h < 12 ? "a. m." : "p. m."}` : String(h);
  const etiquetaMin = (m: number) => String(m);

  // Modo reloj: dos ruedas de 3 filas (hora con a. m./p. m. y minutos ":00"/":30") con una sola banda de selección.
  // Compacto y centrado, no a todo el ancho.
  if (modo === "reloj") {
    return (
      <div className="relative mx-auto flex w-full max-w-[17rem] items-center gap-1 rounded-xl bg-black/[0.03] px-3 dark:bg-white/5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 rounded-lg bg-black/[0.06] dark:bg-white/10"
          style={{ height: ALTO_FILA }}
        />
        <div className="relative flex-[3]">
          <Columna
            items={horas.map((h) => ({ valor: h, etiqueta: etiquetaHora(h) }))}
            valor={horaSel}
            onChange={cambiarHora}
            etiquetaAria="Hora"
            filas={FILAS_RELOJ}
          />
        </div>
        <div className="relative flex-[2]">
          <Columna
            items={minutos.map((m) => ({ valor: m, etiqueta: `:${String(m).padStart(2, "0")}` }))}
            valor={valor % 60}
            onChange={(m) => onChange(horaSel * 60 + m)}
            etiquetaAria="Minutos"
            filas={FILAS_RELOJ}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center gap-2 rounded-xl bg-black/[0.03] px-2 dark:bg-white/5">
      {/* Banda de selección en el centro */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-2 top-1/2 -translate-y-1/2 rounded-lg bg-black/[0.06] dark:bg-white/10"
        style={{ height: ALTO_FILA }}
      />
      <div className="relative w-32">
        <Columna
          items={horas.map((h) => ({ valor: h, etiqueta: etiquetaHora(h) }))}
          valor={horaSel}
          unidad="h"
          onChange={cambiarHora}
          etiquetaAria="Horas"
          filas={FILAS_DURACION}
        />
      </div>
      <div className="relative w-32">
        <Columna
          items={minutos.map((m) => ({ valor: m, etiqueta: etiquetaMin(m) }))}
          valor={valor % 60}
          unidad="min"
          onChange={(m) => onChange(horaSel * 60 + m)}
          etiquetaAria="Minutos"
          filas={FILAS_DURACION}
        />
      </div>
    </div>
  );
}
