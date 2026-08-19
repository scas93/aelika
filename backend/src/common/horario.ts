import { BadRequestException } from '@nestjs/common';

export const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const;
export type DiaSemana = (typeof DIAS_SEMANA)[number];

export interface HorarioDia {
  abierto: boolean;
  apertura: string | null; // "HH:mm"
  cierre: string | null; // "HH:mm"
}

export type HorarioSemana = Record<DiaSemana, HorarioDia>;

// Fase 1 pilot businesses all operate in Mexico City — hardcoded until the
// platform has tenants in other timezones. Uses Intl's IANA tzdata (not
// manual UTC offset math) so DST transitions are handled correctly for free.
const TIMEZONE = 'America/Mexico_City';

const DIA_NORMALIZADO: Record<string, DiaSemana> = {
  lunes: 'lunes',
  martes: 'martes',
  miércoles: 'miercoles',
  miercoles: 'miercoles',
  jueves: 'jueves',
  viernes: 'viernes',
  sábado: 'sabado',
  sabado: 'sabado',
  domingo: 'domingo',
};

function ahoraEnTimezone(now: Date): { dia: DiaSemana; hora: string } {
  const formatter = new Intl.DateTimeFormat('es-MX', {
    timeZone: TIMEZONE,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const weekday = get('weekday').toLowerCase();
  const dia = DIA_NORMALIZADO[weekday] ?? (weekday as DiaSemana);
  const hora = `${get('hour')}:${get('minute')}`;

  return { dia, hora };
}

/**
 * Whether the tenant is open right now, per its structured weekly schedule.
 * Only handles same-day ranges (apertura < cierre) — Fase 1 pickup
 * businesses don't operate past midnight.
 */
export function isAbiertoAhora(horario: HorarioSemana | null | undefined, now = new Date()): boolean {
  if (!horario) return false;

  const { dia, hora } = ahoraEnTimezone(now);
  const horarioDia = horario[dia];
  if (!horarioDia?.abierto || !horarioDia.apertura || !horarioDia.cierre) {
    return false;
  }

  return hora >= horarioDia.apertura && hora < horarioDia.cierre;
}

/** Current time in "HH:mm", in the tenant timezone (see TIMEZONE above). */
export function horaActualMexico(now = new Date()): string {
  return ahoraEnTimezone(now).hora;
}

/** Today's schedule entry, in the tenant timezone — null if no schedule is set at all. */
export function horarioDeHoy(horario: HorarioSemana | null | undefined, now = new Date()): HorarioDia | null {
  if (!horario) return null;
  const { dia } = ahoraEnTimezone(now);
  return horario[dia] ?? null;
}

/** Adds minutes to an "HH:mm" string, clamped to 23:59 (never rolls into the next day). */
export function sumarMinutos(hhmm: string, minutos: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutos, 23 * 60 + 59);
  const horas = Math.floor(total / 60);
  const mins = total % 60;
  return `${String(horas).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function horarioSemanaVacio(): HorarioSemana {
  return DIAS_SEMANA.reduce((acc, dia) => {
    acc[dia] = { abierto: false, apertura: null, cierre: null };
    return acc;
  }, {} as HorarioSemana);
}

/**
 * Normalizes a client-submitted weekly schedule into the shape stored in
 * `Tenant.horarioAtencion`: forces apertura/cierre to null on closed days
 * (regardless of what was sent) and requires a valid apertura < cierre range
 * on open days.
 */
interface HorarioDiaInput {
  abierto: boolean;
  apertura?: string | null;
  cierre?: string | null;
}

export function normalizarHorarioSemana(input: Record<DiaSemana, HorarioDiaInput>): HorarioSemana {
  const resultado = horarioSemanaVacio();

  for (const dia of DIAS_SEMANA) {
    const diaInput = input[dia];
    if (!diaInput?.abierto) {
      resultado[dia] = { abierto: false, apertura: null, cierre: null };
      continue;
    }

    if (!diaInput.apertura || !diaInput.cierre) {
      throw new BadRequestException(`Falta la hora de apertura o cierre para el día "${dia}"`);
    }
    if (diaInput.apertura >= diaInput.cierre) {
      throw new BadRequestException(`La hora de apertura debe ser antes que la de cierre el día "${dia}"`);
    }

    resultado[dia] = { abierto: true, apertura: diaInput.apertura, cierre: diaInput.cierre };
  }

  return resultado;
}
