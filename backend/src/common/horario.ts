import { BadRequestException, ConflictException } from '@nestjs/common';

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

/** Current day of week (see DiaSemana), in the tenant timezone (see TIMEZONE above). */
export function diaActualMexico(now = new Date()): DiaSemana {
  return ahoraEnTimezone(now).dia;
}

/**
 * "YYYY-MM-DD" del día calendario que corresponde a `now` en TIMEZONE — el
 * locale "en-CA" da ese formato directamente vía Intl, sin aritmética manual
 * de offset UTC (mismo criterio que el resto de este archivo). Pensado para
 * comparar "mismo día calendario" entre dos timestamps (ej.
 * LealtadService: ¿ya hay un LoyaltyVisit de hoy para esta tarjeta?) sin
 * tener que calcular límites de día en UTC.
 */
export function fechaEnMexico(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(now);
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

const DIA_POR_INDICE_UTC: DiaSemana[] = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

/** Suma `dias` a una fecha "YYYY-MM-DD" (aritmética de calendario puro: se hace a mediodía UTC, sin offsets). */
export function sumarDiasFecha(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Día de la semana de una fecha de calendario "YYYY-MM-DD". */
export function diaDeFecha(fecha: string): DiaSemana {
  return DIA_POR_INDICE_UTC[new Date(`${fecha}T12:00:00Z`).getUTCDay()];
}

export interface ReglasEntrega {
  /** Horas mínimas entre ahora y la hora elegida (0 = solo el margen base). */
  anticipacionHoras: number;
  /** Cuántos días después del primer día disponible se puede agendar (0 = solo ese día). */
  diasMaxAgendar: number;
  /** Margen base en minutos que siempre aplica (el de "lo antes posible"). */
  margenMinutos: number;
}

/**
 * Primer momento (fecha + "HH:mm", America/Mexico_City) en que se puede entregar: ahora + max(margen, anticipación).
 * Se obtiene formateando el instante resultante con Intl — nunca sumando offsets a mano.
 */
export function entregaMasTemprana(reglas: ReglasEntrega, now = new Date()): { fecha: string; hora: string } {
  const minutos = Math.max(reglas.margenMinutos, reglas.anticipacionHoras * 60);
  const instante = new Date(now.getTime() + minutos * 60_000);
  return { fecha: fechaEnMexico(instante), hora: horaActualMexico(instante) };
}

/**
 * Valida la fecha/hora de entrega que eligió el cliente contra el horario del negocio y las reglas de entrega, y
 * devuelve la fecha resuelta ("YYYY-MM-DD"; hoy si el cliente no mandó una). La hora debe caer dentro del horario del
 * día elegido y no antes de ahora + max(margen, anticipación). Fuente de verdad del servidor; el storefront solo la
 * replica para mostrar opciones.
 */
export function validarEntregaProgramada(
  horario: HorarioSemana | null | undefined,
  entrada: { fecha?: string | null; hora: string },
  reglas: ReglasEntrega,
  now = new Date(),
): string {
  const hoy = fechaEnMexico(now);
  const fecha = entrada.fecha ?? hoy;

  if (fecha < hoy) {
    throw new BadRequestException('Elige una fecha de entrega que no haya pasado');
  }
  // La ventana de días cuenta desde el primer día en que ya se puede entregar (hoy + anticipación), no desde hoy:
  // con 48 h de anticipación, "7 días" son los 7 días siguientes a ese primer día.
  const minima = entregaMasTemprana(reglas, now);
  if (fecha > sumarDiasFecha(minima.fecha, reglas.diasMaxAgendar)) {
    throw new BadRequestException(
      reglas.diasMaxAgendar === 0
        ? 'Este negocio solo recibe pedidos para el primer día disponible'
        : `Solo puedes agendar hasta ${reglas.diasMaxAgendar} día(s) después del primer día disponible`,
    );
  }

  const horarioDia = horario?.[diaDeFecha(fecha)];
  if (!horarioDia?.abierto || !horarioDia.apertura || !horarioDia.cierre) {
    throw new ConflictException('El negocio no tiene horario disponible ese día');
  }
  if (entrada.hora < horarioDia.apertura || entrada.hora >= horarioDia.cierre) {
    throw new BadRequestException(`Elige una hora entre ${horarioDia.apertura} y ${horarioDia.cierre}`);
  }

  if (`${fecha} ${entrada.hora}` < `${minima.fecha} ${minima.hora}`) {
    throw new BadRequestException(
      reglas.anticipacionHoras > 0
        ? `Este negocio requiere al menos ${reglas.anticipacionHoras} hora(s) de anticipación`
        : `Elige una hora a partir de las ${minima.hora}`,
    );
  }

  return fecha;
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
