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

/** Next "HH:mm" that's a multiple of 30 minutes (:00 or :30) strictly after `hhmm`. */
export function siguienteMultiploDe30(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const totalMin = Math.min(h * 60 + m, 23 * 60 + 59);
  const siguiente = Math.min(Math.floor(totalMin / 30) * 30 + 30, 23 * 60 + 59);
  const horas = Math.floor(siguiente / 60);
  const mins = siguiente % 60;
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

// ---------------------------------------------------------------------------
// Reglas de entrega (anticipación mínima y agendar en días futuros). Réplica de UX de
// backend/src/common/horario.ts (validarEntregaProgramada): aquí solo se calculan las opciones a mostrar.
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" de hoy en America/Mexico_City. */
export function fechaActualMexico(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(now);
}

/** Suma días a una fecha "YYYY-MM-DD" (calendario puro, a mediodía UTC). */
export function sumarDiasFecha(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const DIA_POR_INDICE_UTC: DiaSemana[] = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

export function diaDeFecha(fecha: string): DiaSemana {
  return DIA_POR_INDICE_UTC[new Date(`${fecha}T12:00:00Z`).getUTCDay()];
}

/** Primer momento en que se puede entregar: ahora + `minutosMinimos`, expresado en hora de México. */
export function entregaMasTemprana(minutosMinimos: number, now = new Date()): { fecha: string; hora: string } {
  const instante = new Date(now.getTime() + minutosMinimos * 60_000);
  return { fecha: fechaActualMexico(instante), hora: horaActualMexico(instante) };
}

/** Horas (cada `paso` min, dentro del horario) que se pueden elegir en `fecha` respetando el mínimo. */
export function horasDisponiblesParaFecha(
  horario: HorarioSemana | null,
  fecha: string,
  minutosMinimos: number,
  now = new Date(),
  paso = 30,
): string[] {
  const dia = horario?.[diaDeFecha(fecha)];
  if (!dia?.abierto || !dia.apertura || !dia.cierre) return [];
  const minima = entregaMasTemprana(minutosMinimos, now);
  if (fecha < minima.fecha) return [];
  const aMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  let desde = aMin(dia.apertura);
  if (fecha === minima.fecha) desde = Math.max(desde, Math.ceil(aMin(minima.hora) / paso) * paso);
  const hasta = aMin(dia.cierre);
  const horas: string[] = [];
  for (let t = desde; t < hasta; t += paso) {
    horas.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return horas;
}

/**
 * Duraciones ("recoger en X min", pasos de 15) elegibles hoy: desde el mínimo (margen o anticipación, redondeado hacia
 * arriba) hasta que la hora resultante siga antes del cierre. Vacío si hoy no abre.
 */
export function duracionesDisponibles(
  horario: HorarioSemana | null,
  minutosMinimos: number,
  now = new Date(),
  paso = 15,
): number[] {
  const hoyHorario = horarioDeHoy(horario, now);
  if (!hoyHorario?.abierto || !hoyHorario.cierre) return [];
  const aMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const maximo = Math.floor((aMin(hoyHorario.cierre) - aMin(horaActualMexico(now)) - 1) / paso) * paso;
  const duraciones: number[] = [];
  for (let d = Math.ceil(minutosMinimos / paso) * paso; d <= maximo; d += paso) duraciones.push(d);
  return duraciones;
}

export function etiquetaDia(fecha: string, hoy: string): string {
  if (fecha === hoy) return "Hoy";
  if (fecha === sumarDiasFecha(hoy, 1)) return "Mañana";
  const texto = new Intl.DateTimeFormat("es-MX", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${fecha}T12:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Días elegibles: la ventana de `diasMax` días cuenta desde el primer día en que ya se puede entregar
 * (hoy + anticipación), no desde hoy. Los días cerrados o sin horas se omiten.
 */
export function diasDisponibles(
  horario: HorarioSemana | null,
  diasMax: number,
  minutosMinimos: number,
  now = new Date(),
): { fecha: string; etiqueta: string }[] {
  const hoy = fechaActualMexico(now);
  const primero = entregaMasTemprana(minutosMinimos, now).fecha;
  const dias: { fecha: string; etiqueta: string }[] = [];
  for (let i = 0; i <= diasMax; i++) {
    const fecha = sumarDiasFecha(primero, i);
    if (horasDisponiblesParaFecha(horario, fecha, minutosMinimos, now).length > 0) {
      dias.push({ fecha, etiqueta: etiquetaDia(fecha, hoy) });
    }
  }
  return dias;
}

/** Para los chips de día: "Hoy" / "Mañana" / "Vie" arriba y "13 nov" abajo. */
export function partesDia(fecha: string, hoy: string): { titulo: string; detalle: string } {
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", ...opts }).format(new Date(`${fecha}T12:00:00Z`));
  const detalle = fmt({ day: "numeric", month: "short" }).replace(".", "");
  let titulo = "Hoy";
  if (fecha !== hoy) {
    titulo =
      fecha === sumarDiasFecha(hoy, 1)
        ? "Mañana"
        : fmt({ weekday: "short" }).replace(".", "").replace(/^./, (c) => c.toUpperCase());
  }
  return { titulo, detalle };
}
