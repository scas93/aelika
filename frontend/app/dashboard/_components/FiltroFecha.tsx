"use client";

import Calendario, { type RangoFechas } from "./Calendario";

// Filtro de fecha: un calendario que se abre directo al tocar el chip. Se aplica al elegir la segunda fecha. `modo="semana"`
// (B2B) selecciona semanas completas. El valor es siempre un rango absoluto (desde/hasta en "YYYY-MM-DD").
export type FiltroFechaValue = RangoFechas;

// Para columnas con hora (createdAt): desde = inicio del día en UTC, hasta = fin del día local — la misma frontera de siempre
// (siempre pasa por un "YYYY-MM-DD", nunca un Date local crudo).
export function resolverFiltroFecha(value: FiltroFechaValue | null): { desde?: string; hasta?: string } {
  if (!value) return {};
  return {
    desde: value.desde ? new Date(value.desde).toISOString() : undefined,
    hasta: value.hasta ? new Date(`${value.hasta}T23:59:59.999`).toISOString() : undefined,
  };
}

// Para columnas de solo fecha (semanaInicio, @db.Date = medianoche UTC): ambos extremos a medianoche UTC. Con el fin de día
// local, el domingo de una semana dejaría entrar el lunes siguiente.
export function resolverFiltroSemana(value: FiltroFechaValue | null): { desde?: string; hasta?: string } {
  if (!value) return {};
  return { desde: new Date(value.desde).toISOString(), hasta: new Date(value.hasta).toISOString() };
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function partes(f: string) {
  const [y, m, d] = f.split("-").map(Number);
  return { y, m: MESES_CORTOS[m - 1], d };
}

// «1–19 oct», «28 sep – 5 oct», «19 oct»; con año solo si el rango cruza años o no es del año en curso.
export function labelFiltroFecha(value: FiltroFechaValue | null): string | null {
  if (!value?.desde || !value.hasta) return null;
  const a = partes(value.desde);
  const b = partes(value.hasta);
  const anioActual = new Date().getFullYear();
  const conAnio = a.y !== b.y || b.y !== anioActual;
  const sufijo = (p: { y: number }) => (conAnio ? ` ${p.y}` : "");
  if (value.desde === value.hasta) return `${a.d} ${a.m}${sufijo(b)}`;
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${b.m}${sufijo(b)}`;
  return `${a.d} ${a.m}${a.y !== b.y ? ` ${a.y}` : ""} – ${b.d} ${b.m}${sufijo(b)}`;
}

export function FiltroFechaPopover({
  valorAplicado,
  onAplicar,
  close,
  modo = "dia",
}: {
  valorAplicado: FiltroFechaValue | null;
  onAplicar: (value: FiltroFechaValue | null) => void;
  close: () => void;
  modo?: "dia" | "semana";
}) {
  return (
    <Calendario
      modo={modo}
      valor={valorAplicado}
      onElegir={(rango) => {
        onAplicar(rango);
        close();
      }}
    />
  );
}
