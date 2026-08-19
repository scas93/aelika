import type { DiaSemana, HorarioSemana } from "./api";

// Mirrors backend/src/common/horario.ts — same hardcoded timezone, same
// same-day-only assumption. Client-side use here is UX only (which options
// to show); the server is still the source of truth and re-validates.
const TIMEZONE = "America/Mexico_City";

const DIA_NORMALIZADO: Record<string, DiaSemana> = {
  lunes: "lunes",
  martes: "martes",
  miércoles: "miercoles",
  miercoles: "miercoles",
  jueves: "jueves",
  viernes: "viernes",
  sábado: "sabado",
  sabado: "sabado",
  domingo: "domingo",
};

function ahoraEnTimezone(now: Date): { dia: DiaSemana; hora: string } {
  const formatter = new Intl.DateTimeFormat("es-MX", {
    timeZone: TIMEZONE,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday").toLowerCase();
  const dia = DIA_NORMALIZADO[weekday] ?? (weekday as DiaSemana);
  const hora = `${get("hour")}:${get("minute")}`;
  return { dia, hora };
}

export function horaActualMexico(now = new Date()): string {
  return ahoraEnTimezone(now).hora;
}

export function horarioDeHoy(horario: HorarioSemana | null, now = new Date()) {
  if (!horario) return null;
  const { dia } = ahoraEnTimezone(now);
  return horario[dia] ?? null;
}

export function sumarMinutos(hhmm: string, minutos: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min(h * 60 + m + minutos, 23 * 60 + 59);
  const horas = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(horas).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/** 15-minute-interval time options in [desde, hasta). */
export function generarOpcionesHora(desde: string, hasta: string, pasoMinutos = 15): string[] {
  const opciones: string[] = [];
  let actual = desde;
  while (actual < hasta) {
    opciones.push(actual);
    actual = sumarMinutos(actual, pasoMinutos);
  }
  return opciones;
}
