"use client";

import { useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { hoyYYYYMMDD } from "@/lib/fecha";
import Calendario, { lunesDe } from "./Calendario";
import Popover from "./Popover";

// Un solo componente para navegar por día o por semana en cualquier pantalla: [ ‹ | etiqueta | › ] con borde, misma altura que los
// demás botones de la fila (44 px), flechas con el mismo ícono y tamaño, etiqueta de ancho fijo (las flechas no se mueven). Clic en la
// etiqueta abre un calendario (día: eliges un día; semana: al elegir un día se toma su semana completa). Junto al grupo aparece «Hoy»
// o «Esta semana» solo cuando no estás en el periodo actual.
//
// El valor es "YYYY-MM-DD": el día, o el LUNES de la semana. `min`/`max` limitan la navegación (el calendario y las flechas); si una
// flecha no tiene destino se ve desactivada, con `tooltipMin`/`tooltipMax` como explicación.
const aUTC = (f: string) => {
  const [y, m, d] = f.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const sumarDias = (f: string, n: number) => new Date(aUTC(f) + n * 86_400_000).toISOString().slice(0, 10);

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const dia = (f: string) => Number(f.slice(8));
const mes = (f: string) => MESES[Number(f.slice(5, 7)) - 1];

export function etiquetaDia(valor: string, hoy: string): string {
  const texto = `${DIAS[new Date(aUTC(valor)).getUTCDay()]} ${dia(valor)} ${mes(valor)}`;
  const rel = valor === hoy ? "Hoy" : valor === sumarDias(hoy, 1) ? "Mañana" : valor === sumarDias(hoy, -1) ? "Ayer" : null;
  return rel ? `${rel} · ${texto}` : texto;
}

function rangoSemana(lunes: string): string {
  const fin = sumarDias(lunes, 6);
  return mes(lunes) === mes(fin) ? `${dia(lunes)}–${dia(fin)} ${mes(fin)}` : `${dia(lunes)} ${mes(lunes)}–${dia(fin)} ${mes(fin)}`;
}

export function etiquetaSemana(lunes: string, hoy: string): string {
  const actual = lunesDe(hoy);
  const rango = rangoSemana(lunes);
  if (lunes === actual) return `Esta semana · ${rango}`;
  if (lunes === sumarDias(actual, 7)) return `Próxima semana · ${rango}`;
  if (lunes === sumarDias(actual, -7)) return `Semana pasada · ${rango}`;
  return `Semana del ${rango}`;
}

// Etiqueta corta para cuando el espacio es poco: sin «Hoy/Esta semana…» en semanas y sin el día de la semana en días.
export function etiquetaDiaCorta(valor: string, hoy: string): string {
  const texto = `${dia(valor)} ${mes(valor)}`;
  const rel = valor === hoy ? "Hoy" : valor === sumarDias(hoy, 1) ? "Mañana" : valor === sumarDias(hoy, -1) ? "Ayer" : null;
  return rel ? `${rel} · ${texto}` : texto;
}

/** Acción «Hoy» / «Esta semana» para la barra de controles: solo existe cuando no estás en el periodo actual. */
export function accionPeriodo(modo: "dia" | "semana", valor: string, onChange: (v: string) => void, deshabilitado = false) {
  const hoy = hoyYYYYMMDD();
  const actual = modo === "semana" ? lunesDe(hoy) : hoy;
  if (valor === actual) return null;
  return { key: "periodo-actual", label: modo === "semana" ? "Esta semana" : "Hoy", tipo: "periodo" as const, onClick: () => onChange(actual), disabled: deshabilitado };
}

export default function SelectorPeriodo({
  modo,
  valor,
  onChange,
  min,
  max,
  tooltipMin,
  tooltipMax,
  deshabilitado = false,
  corto = false,
}: {
  modo: "dia" | "semana";
  valor: string;
  onChange: (valor: string) => void;
  min?: string;
  max?: string;
  tooltipMin?: string;
  tooltipMax?: string;
  deshabilitado?: boolean;
  /** Etiqueta acortada (poco espacio): «19–25 oct», «Hoy · 19 oct». */
  corto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const hoy = hoyYYYYMMDD();
  const paso = modo === "semana" ? 7 : 1;
  const etiquetaLarga = modo === "semana" ? etiquetaSemana(valor, hoy) : etiquetaDia(valor, hoy);
  const etiqueta = !corto ? etiquetaLarga : modo === "semana" ? rangoSemana(valor) : etiquetaDiaCorta(valor, hoy);
  // Ancho fijo (en ch, del texto más largo posible de cada variante): las flechas no se mueven y la etiqueta queda centrada.
  const ancho = modo === "semana" ? (corto ? 15 : 32) : corto ? 18 : 22;
  const anterior = sumarDias(valor, -paso);
  const siguiente = sumarDias(valor, paso);
  const sinAnterior = deshabilitado || (min !== undefined && anterior < min);
  const sinSiguiente = deshabilitado || (max !== undefined && siguiente > max);

  const flecha = "inline-flex h-full w-barra shrink-0 items-center justify-center text-admin-ink transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="flex h-barra shrink-0 items-stretch overflow-hidden rounded-[var(--radius-admin-control)] border border-admin-border bg-white">
        <span title={sinAnterior ? tooltipMin : undefined} className="flex">
          <button type="button" className={flecha} onClick={() => onChange(anterior)} disabled={sinAnterior} aria-label={modo === "semana" ? "Semana anterior" : "Día anterior"}>
            <IconChevronLeft size={18} />
          </button>
        </span>
        <Popover
          open={abierto}
          onClose={() => setAbierto(false)}
          trigger={
            <button
              type="button"
              onClick={() => setAbierto((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={abierto}
              aria-label="Elegir periodo"
              style={{ width: `${ancho}ch` }}
              className="h-full truncate border-x border-admin-border px-2 text-center text-sm font-bold text-admin-ink hover:bg-admin-bg"
            >
              {etiqueta}
            </button>
          }
        >
          <Calendario
            modo={modo}
            unico
            min={min}
            max={max}
            valor={{ desde: valor, hasta: modo === "semana" ? sumarDias(valor, 6) : valor }}
            onElegir={(r) => {
              onChange(r.desde);
              setAbierto(false);
            }}
          />
        </Popover>
        <span title={sinSiguiente ? tooltipMax : undefined} className="flex">
          <button type="button" className={flecha} onClick={() => onChange(siguiente)} disabled={sinSiguiente} aria-label={modo === "semana" ? "Semana siguiente" : "Día siguiente"}>
            <IconChevronRight size={18} />
          </button>
        </span>
      </div>
  );
}
