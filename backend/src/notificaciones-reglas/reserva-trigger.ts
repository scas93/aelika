import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { fechaEnMexico } from '../common/horario';

/**
 * Trigger RESERVA_AUTOMATICA (solo negocios HOTEL): lógica pura de frecuencia, filtro y fechas. Todo en hora de CDMX
 * (America/Mexico_City, vía common/horario.ts), nunca la zona del servidor.
 *
 *  - triggerConfig: { frecuencia: 'CADA_HORA' } | { frecuencia: 'DIARIA', hora: 0–23 }.
 *    CADA_HORA se evalúa en cada barrido. DIARIA se evalúa en cada barrido desde esa hora hasta el fin del día (CDMX): una
 *    reserva que llega a Aelika después de la hora todavía recibe el mensaje ese mismo día, nunca al siguiente.
 *  - filtro (JSON, condiciones unidas con Y): días para el check-in (negativo = ya pasó, 0 = hoy), días desde el check-out
 *    (0 = hoy, 1 = ayer) e idioma del huésped (sin idioma = ES). Días de CALENDARIO en CDMX, no horas transcurridas.
 *    Debe haber al menos una condición de días: nunca se envía a todas las reservas.
 */
export type FrecuenciaReserva = 'CADA_HORA' | 'DIARIA';
export interface TriggerConfigReserva {
  frecuencia: FrecuenciaReserva;
  hora?: number;
}

export type CampoFiltroReserva = 'DIAS_PARA_CHECKIN' | 'DIAS_DESDE_CHECKOUT' | 'IDIOMA_HUESPED';
export type OperadorDias = 'IGUAL' | 'MAYOR_IGUAL' | 'MENOR_IGUAL';
export type OperadorIdioma = 'ES' | 'NO_ES';
export interface CondicionReserva {
  campo: CampoFiltroReserva;
  operador: OperadorDias | OperadorIdioma;
  valor: number | string;
}

export const IDIOMAS_RESERVA = ['ES', 'EN', 'DE'] as const;
const OPERADORES_DIAS: string[] = ['IGUAL', 'MAYOR_IGUAL', 'MENOR_IGUAL'];
const DIA_MS = 24 * 60 * 60 * 1000;
const LIMITE_DIAS = 3650;

type Obj = Record<string, unknown>;
const esObjeto = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validarTriggerConfigReserva(raw: unknown): TriggerConfigReserva {
  if (!esObjeto(raw)) throw new BadRequestException('triggerConfig inválido para RESERVA_AUTOMATICA: se espera { frecuencia, hora? }');
  const claves = Object.keys(raw).filter((k) => k !== 'frecuencia' && k !== 'hora');
  if (claves.length > 0) throw new BadRequestException(`triggerConfig inválido para RESERVA_AUTOMATICA: campo no permitido "${claves[0]}"`);
  if (raw.frecuencia === 'CADA_HORA') {
    if (raw.hora !== undefined) throw new BadRequestException('Una regla "cada hora" no lleva hora');
    return { frecuencia: 'CADA_HORA' };
  }
  if (raw.frecuencia === 'DIARIA') {
    if (typeof raw.hora !== 'number' || !Number.isInteger(raw.hora) || raw.hora < 0 || raw.hora > 23) {
      throw new BadRequestException('La hora de una regla diaria debe ser un entero de 0 a 23 (hora de CDMX)');
    }
    return { frecuencia: 'DIARIA', hora: raw.hora };
  }
  throw new BadRequestException('frecuencia debe ser CADA_HORA o DIARIA');
}

export function validarFiltroReserva(raw: unknown[]): CondicionReserva[] {
  const condiciones = raw.map((el): CondicionReserva => {
    if (!esObjeto(el)) throw new BadRequestException('Condición de filtro de reserva inválida');
    const extra = Object.keys(el).filter((k) => !['campo', 'operador', 'valor'].includes(k));
    if (extra.length > 0) throw new BadRequestException(`Condición de filtro de reserva: campo no permitido "${extra[0]}"`);
    if (el.campo === 'DIAS_PARA_CHECKIN' || el.campo === 'DIAS_DESDE_CHECKOUT') {
      if (typeof el.operador !== 'string' || !OPERADORES_DIAS.includes(el.operador)) {
        throw new BadRequestException(`${el.campo}: operador debe ser IGUAL, MAYOR_IGUAL o MENOR_IGUAL`);
      }
      if (typeof el.valor !== 'number' || !Number.isInteger(el.valor) || Math.abs(el.valor) > LIMITE_DIAS) {
        throw new BadRequestException(`${el.campo}: valor debe ser un número entero de días`);
      }
      return { campo: el.campo, operador: el.operador as OperadorDias, valor: el.valor };
    }
    if (el.campo === 'IDIOMA_HUESPED') {
      if (el.operador !== 'ES' && el.operador !== 'NO_ES') throw new BadRequestException('IDIOMA_HUESPED: operador debe ser ES o NO_ES');
      if (typeof el.valor !== 'string' || !(IDIOMAS_RESERVA as readonly string[]).includes(el.valor.toUpperCase())) {
        throw new BadRequestException(`IDIOMA_HUESPED: valor debe ser uno de ${IDIOMAS_RESERVA.join(', ')}`);
      }
      return { campo: 'IDIOMA_HUESPED', operador: el.operador, valor: el.valor.toUpperCase() };
    }
    throw new BadRequestException('Campo de filtro de reserva no soportado (DIAS_PARA_CHECKIN, DIAS_DESDE_CHECKOUT, IDIOMA_HUESPED)');
  });
  if (!condiciones.some((c) => c.campo !== 'IDIOMA_HUESPED')) {
    throw new BadRequestException('Una regla de reservas necesita al menos una condición de días (para el check-in o desde el check-out)');
  }
  return condiciones;
}

/** Hora entera (0–23) en CDMX. */
export function horaCdmx(ahora: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', hourCycle: 'h23' }).format(ahora),
  );
}

/** Día calendario de hoy en CDMX como fecha UTC a medianoche (comparable con las columnas @db.Date). */
export function hoyCdmx(ahora: Date): Date {
  return new Date(`${fechaEnMexico(ahora)}T00:00:00.000Z`);
}

/** ¿Toca evaluar la regla en este barrido? CADA_HORA siempre; DIARIA desde su hora hasta el fin del día CDMX. */
export function ventanaActiva(config: TriggerConfigReserva, ahora: Date): boolean {
  return config.frecuencia === 'CADA_HORA' || horaCdmx(ahora) >= (config.hora ?? 0);
}

const sumarDias = (fecha: Date, dias: number) => new Date(fecha.getTime() + dias * DIA_MS);

/** Condiciones de días traducidas a fechas de calendario sobre DetalleReserva (el idioma se resuelve en `coincideIdioma`). */
export function condicionesDiasAWhere(condiciones: CondicionReserva[], hoy: Date): Prisma.DetalleReservaWhereInput[] {
  const donde: Prisma.DetalleReservaWhereInput[] = [];
  for (const c of condiciones) {
    if (c.campo === 'DIAS_PARA_CHECKIN') {
      const f = sumarDias(hoy, c.valor as number); // díasParaCheckin = checkIn − hoy
      donde.push({ checkIn: c.operador === 'IGUAL' ? f : c.operador === 'MAYOR_IGUAL' ? { gte: f } : { lte: f } });
    } else if (c.campo === 'DIAS_DESDE_CHECKOUT') {
      const f = sumarDias(hoy, -(c.valor as number)); // díasDesdeCheckout = hoy − checkOut
      donde.push({ checkOut: c.operador === 'IGUAL' ? f : c.operador === 'MAYOR_IGUAL' ? { lte: f } : { gte: f } });
    }
  }
  return donde;
}

/** Idioma ES / NO_ES; una reserva sin idioma cuenta como ES. */
export function coincideIdioma(condiciones: CondicionReserva[], idiomaHuesped: string | null): boolean {
  const idioma = (idiomaHuesped?.trim() || 'ES').toUpperCase();
  return condiciones
    .filter((c) => c.campo === 'IDIOMA_HUESPED')
    .every((c) => (c.operador === 'ES' ? idioma === c.valor : idioma !== c.valor));
}
