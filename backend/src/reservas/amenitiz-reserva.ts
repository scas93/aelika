import { BadRequestException } from '@nestjs/common';
import { normalizarTelefonoInternacional } from '../common/telefono-internacional';

/** Códigos de error 400 del endpoint (campo `codigo` del cuerpo), para que Make los distinga. */
export type CodigoErrorReserva =
  | 'FORMATO_INVALIDO'
  | 'FALTA_ID'
  | 'ESTADO_DESCONOCIDO'
  | 'FECHAS_INVALIDAS'
  | 'TOTAL_INVALIDO';

export function errorReserva(codigo: CodigoErrorReserva, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', codigo, message });
}

/** Reserva de Amenitiz ya validada y mapeada a lo que guarda Aelika. */
export interface ReservaNormalizada {
  pmsReservaId: string;
  cancelada: boolean;
  checkIn: Date;
  checkOut: Date;
  adultos: number;
  ninos: number;
  habitaciones: string | null;
  origen: string | null;
  moneda: string | null;
  /** Número con 2 decimales (texto). Falta/vacío = "0.00". */
  total: string;
  idiomaHuesped: string | null;
  onlineCheckinUrl: string | null;
  /** null si el huésped no trae nombre (create usa "Huésped"; update conserva el guardado). */
  nombre: string | null;
  correo: string | null;
  /** Teléfono normalizado (México 10 dígitos / internacional con "+"); null = vacío o inutilizable. */
  telefono: string | null;
}

type Obj = Record<string, unknown>;
const esObjeto = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const texto = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
};

function fecha(v: unknown, campo: string): Date {
  const t = texto(v);
  const m = t ? /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t) : null;
  if (!m) throw errorReserva('FECHAS_INVALIDAS', `${campo} debe ser una fecha YYYY-MM-DD`);
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) {
    throw errorReserva('FECHAS_INVALIDAS', `${campo} no es una fecha válida`);
  }
  return d;
}

const entero = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0;
};

/** Valida el objeto de reserva tal como lo devuelve Amenitiz (`bookings/updated`) y lo mapea. Ignora campos desconocidos. */
export function parsearReservaAmenitiz(body: unknown): ReservaNormalizada {
  if (!esObjeto(body)) {
    throw errorReserva('FORMATO_INVALIDO', 'Se espera UN objeto de reserva por petición (no un arreglo)');
  }

  const id = typeof body.booking_id === 'number' && !Number.isSafeInteger(body.booking_id) ? null : texto(body.booking_id);
  if (!id) throw errorReserva('FALTA_ID', 'Falta booking_id');

  const status = texto(body.status)?.toLowerCase();
  if (status !== 'confirmed' && status !== 'modified' && status !== 'cancelled') {
    throw errorReserva('ESTADO_DESCONOCIDO', `status desconocido: ${status ?? '(vacío)'}`);
  }

  const checkIn = fecha(body.checkin, 'checkin');
  const checkOut = fecha(body.checkout, 'checkout');
  if (checkOut.getTime() <= checkIn.getTime()) {
    throw errorReserva('FECHAS_INVALIDAS', 'checkout debe ser posterior a checkin');
  }

  let total = '0.00';
  const totalCrudo = texto(body.total_amount_after_tax);
  if (totalCrudo !== null) {
    const n = Number(totalCrudo);
    if (!Number.isFinite(n) || n < 0 || n >= 100_000_000) {
      throw errorReserva('TOTAL_INVALIDO', 'total_amount_after_tax no es un monto válido');
    }
    total = n.toFixed(2);
  }

  const booker = esObjeto(body.booker) ? body.booker : {};
  const nombre = [texto(booker.first_name), texto(booker.last_name)].filter(Boolean).join(' ') || null;

  const habitaciones = Array.isArray(body.rooms)
    ? body.rooms
        .filter(esObjeto)
        .map((r) => {
          const nombreHab = texto(r.individual_room_name);
          const numero = texto(r.individual_room_number);
          return [nombreHab, numero ? `#${numero}` : null].filter(Boolean).join(' ');
        })
        .filter((h) => h !== '')
        .join(', ') || null
    : null;

  return {
    pmsReservaId: id,
    cancelada: status === 'cancelled',
    checkIn,
    checkOut,
    adultos: entero(body.adults),
    ninos: entero(body.children),
    habitaciones,
    origen: texto(body.source),
    moneda: texto(body.currency_code),
    total,
    idiomaHuesped: texto(booker.language),
    onlineCheckinUrl: texto(body.online_checkin_url),
    nombre,
    correo: texto(booker.email),
    telefono: normalizarTelefonoInternacional(texto(booker.phone)),
  };
}
