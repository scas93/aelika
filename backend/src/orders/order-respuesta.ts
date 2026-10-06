import { InternalServerErrorException, Logger } from '@nestjs/common';
import type { DetalleB2C } from '../../generated/prisma/client';

const logger = new Logger('OrderRespuesta');

/**
 * Campos exclusivos de B2C que viven en DetalleB2C (Etapa 1 del refactor de
 * órdenes centralizadas). Las columnas viejas homónimas de Order siguen en el esquema,
 * deprecadas y SIN escribirse (Etapa 1b-a); se eliminan en la Etapa 1b-b.
 */
const CAMPOS_DETALLE_B2C = [
  'horaRecogidaTipo',
  'horaRecogida',
  'metodoEntrega',
  'puntoEnvioId',
  'direccionCalle',
  'direccionNumero',
  'direccionColonia',
  'direccionReferencias',
  'notasDescuento',
] as const satisfies readonly (keyof DetalleB2C)[];

/**
 * Una orden B2C siempre tiene su `DetalleB2C`: se crea en la MISMA transacción que la orden
 * (PublicService.createOrder). Desde la Etapa 1b-a ya no hay respaldo a las columnas viejas, así que una
 * orden sin detalle es una inconsistencia de datos: se registra con el id de la orden y se falla con un
 * 500 genérico (nunca se inventan valores). Las listas la omiten con `aRespuestaOrdenes`.
 */
export function exigirDetalleB2C<T extends { id?: string; detalleB2c?: DetalleB2C | null }>(
  order: T,
): T & { detalleB2c: DetalleB2C } {
  if (!order.detalleB2c) {
    logger.error(`La orden ${order.id ?? '(sin id)'} es B2C y no tiene DetalleB2C: inconsistencia de datos`);
    throw new InternalServerErrorException();
  }
  return order as T & { detalleB2c: DetalleB2C };
}

/** Forma de salida: sin los campos internos (`tipo`, `detalleB2c`, `huellaCheckout`) ni los del módulo B2B (`cancelado`, `canceladoAt`). */
type RespuestaOrder<T> = Omit<T, 'tipo' | 'detalleB2c' | 'huellaCheckout' | 'cancelado' | 'canceladoAt'>;

/**
 * ÚNICO punto donde una orden (fila de Prisma + su relación `detalleB2c`) se
 * convierte a la forma PLANA que expone la API y consumen las salidas internas
 * (recibo de Telegram, contexto de reglas): sin `tipo` ni `detalleB2c`, con los
 * campos B2C en la raíz. El contrato de la API no expone el detalle por separado.
 *
 * Fuente de los campos B2C: SOLO el detalle (Etapa 1b-a). Sin detalle lanza (ver `exigirDetalleB2C`).
 */
export function aRespuestaOrder<T extends { id?: string; tipo?: unknown; detalleB2c?: DetalleB2C | null; huellaCheckout?: unknown }>(
  order: T,
): RespuestaOrder<T> {
  const { detalleB2c } = exigirDetalleB2C(order);
  // huellaCheckout (Parte B1) es interna del servidor — nunca viaja en la API ni en las salidas internas.
  // cancelado/canceladoAt (Etapa 2) son del módulo B2B: B2C no tiene cancelación y su contrato no cambia.
  const {
    tipo: _tipo,
    huellaCheckout: _huella,
    cancelado: _cancelado,
    canceladoAt: _canceladoAt,
    detalleB2c: _detalle,
    ...resto
  } = order as T & { cancelado?: unknown; canceladoAt?: unknown };
  const base = sinOrdenEnItems(resto);
  const campos = Object.fromEntries(CAMPOS_DETALLE_B2C.map((campo) => [campo, detalleB2c[campo]]));
  return { ...base, ...campos } as RespuestaOrder<T>;
}

/** `OrderItem.orden` (Etapa 2) solo lo puebla B2B: no se expone en los ítems de una orden B2C. */
function sinOrdenEnItems<R extends object>(resto: R): R {
  const items = (resto as { items?: unknown }).items;
  if (!Array.isArray(items)) return resto;
  return { ...resto, items: items.map(({ orden: _orden, ...item }) => item) };
}

/** Para listas: una orden sin detalle se omite (con log de error por cada una) en vez de tumbar toda la lista. */
export function aRespuestaOrdenes<T extends { id?: string; tipo?: unknown; detalleB2c?: DetalleB2C | null; huellaCheckout?: unknown }>(
  ordenes: T[],
): RespuestaOrder<T>[] {
  const res: RespuestaOrder<T>[] = [];
  for (const orden of ordenes) {
    if (!orden.detalleB2c) {
      logger.error(`La orden ${orden.id ?? '(sin id)'} es B2C y no tiene DetalleB2C: se omite de la lista (inconsistencia de datos)`);
      continue;
    }
    res.push(aRespuestaOrder(orden));
  }
  return res;
}
