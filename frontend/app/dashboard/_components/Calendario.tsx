"use client";

import { useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { hoyYYYYMMDD } from "@/lib/fecha";

export interface RangoFechas {
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_SEMANA = ["L", "M", "M", "J", "V", "S", "D"];

// Fechas como "YYYY-MM-DD" y aritmética en UTC: la zona horaria del navegador nunca mueve un día.
const aUTC = (f: string) => {
  const [y, m, d] = f.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const deUTC = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sumarDias = (f: string, n: number) => deUTC(aUTC(f) + n * 86_400_000);
// Lunes = 0 … domingo = 6
const diaSemana = (f: string) => (new Date(aUTC(f)).getUTCDay() + 6) % 7;
export const lunesDe = (f: string) => sumarDias(f, -diaSemana(f));
export const domingoDe = (f: string) => sumarDias(lunesDe(f), 6);

/**
 * Calendario de un mes para elegir un rango (desde/hasta): el primer clic marca el inicio y el segundo el final (el orden da
 * igual: se ordenan solos). Con `modo="semana"`, cada clic selecciona la semana completa del día (lunes a domingo): el rango
 * va del lunes de la primera semana al domingo de la última. Llama a `onElegir` al elegir la segunda fecha.
 */
export default function Calendario({
  modo = "dia",
  valor,
  onElegir,
  unico = false,
  min,
  max,
}: {
  modo?: "dia" | "semana";
  valor: RangoFechas | null;
  onElegir: (rango: RangoFechas) => void;
  /** Un solo clic elige (un día, o la semana completa de ese día): sin segunda fecha. */
  unico?: boolean;
  /** Días fuera de [min, max] (YYYY-MM-DD) no se pueden elegir. */
  min?: string;
  max?: string;
}) {
  const hoy = hoyYYYYMMDD();
  const [mes, setMes] = useState((valor?.desde ?? hoy).slice(0, 7)); // YYYY-MM
  const [pendiente, setPendiente] = useState<string | null>(null);

  const [anio, mesNum] = mes.split("-").map(Number);
  const primero = `${mes}-01`;
  const diasEnMes = new Date(Date.UTC(anio, mesNum, 0)).getUTCDate();
  const celdas: (string | null)[] = [
    ...Array.from({ length: diaSemana(primero) }, () => null),
    ...Array.from({ length: diasEnMes }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`),
  ];

  function moverMes(delta: number) {
    const d = new Date(Date.UTC(anio, mesNum - 1 + delta, 1));
    setMes(d.toISOString().slice(0, 7));
  }

  function elegir(dia: string) {
    const base = modo === "semana" ? lunesDe(dia) : dia;
    if (unico) {
      onElegir({ desde: base, hasta: modo === "semana" ? domingoDe(dia) : dia });
      return;
    }
    if (pendiente === null) {
      setPendiente(base);
      return;
    }
    const [a, b] = pendiente <= base ? [pendiente, base] : [base, pendiente];
    setPendiente(null);
    onElegir({ desde: a, hasta: modo === "semana" ? domingoDe(b) : b });
  }

  // Lo que se pinta: la selección en curso (solo el inicio) o el rango ya aplicado.
  const vista: RangoFechas | null = pendiente
    ? { desde: pendiente, hasta: modo === "semana" ? domingoDe(pendiente) : pendiente }
    : valor;

  return (
    <div className="flex w-64 flex-col gap-2">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => moverMes(-1)} aria-label="Mes anterior" className="rounded p-1 text-admin-ink-soft hover:bg-admin-bg">
          <IconChevronLeft size={16} />
        </button>
        <span className="text-sm font-bold capitalize text-admin-ink">
          {MESES[mesNum - 1]} {anio}
        </span>
        <button type="button" onClick={() => moverMes(1)} aria-label="Mes siguiente" className="rounded p-1 text-admin-ink-soft hover:bg-admin-bg">
          <IconChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-xs font-semibold text-admin-ink-soft">
        {DIAS_SEMANA.map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {celdas.map((dia, i) => {
          if (!dia) return <span key={`v${i}`} />;
          const dentro = vista !== null && dia >= vista.desde && dia <= vista.hasta;
          const fuera = (min !== undefined && dia < min) || (max !== undefined && dia > max);
          const extremo = vista !== null && (dia === vista.desde || dia === vista.hasta);
          return (
            <button
              key={dia}
              type="button"
              onClick={() => elegir(dia)}
              disabled={fuera}
              aria-label={dia}
              aria-pressed={dentro}
              className={`h-8 text-sm transition ${
                extremo
                  ? "rounded-md bg-admin-accent font-bold text-white"
                  : dentro
                    ? "bg-admin-accent-soft text-admin-accent-dark"
                    : "rounded-md text-admin-ink hover:bg-admin-bg"
              } ${fuera ? "cursor-not-allowed opacity-30" : ""} ${dia === hoy && !extremo ? "font-bold underline" : ""}`}
            >
              {Number(dia.slice(8))}
            </button>
          );
        })}
      </div>

      {!unico && (
      <p className="text-xs text-admin-ink-soft">
        {pendiente
          ? modo === "semana"
            ? "Elige la semana final"
            : "Elige la fecha final"
          : modo === "semana"
            ? "Elige la semana inicial (se toma completa)"
            : "Elige la fecha inicial"}
      </p>
      )}
    </div>
  );
}
