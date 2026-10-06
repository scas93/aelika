import type { DetalleB2C } from '../../generated/prisma/client';

/**
 * Campos exclusivos de B2C que viven en DetalleB2C (Etapa 1 del refactor de
 * órdenes centralizadas). Siguen existiendo, deprecados, como columnas de Order.
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
 * ÚNICO punto donde una orden (fila de Prisma + su relación `detalleB2c`) se
 * convierte a la forma PLANA que expone la API y consumen las salidas internas
 * (recibo de Telegram, contexto de reglas): sin `tipo` ni `detalleB2c`, con los
 * campos B2C en la raíz. El contrato de la API no expone el detalle por separado.
 *
 * Fuente de los campos B2C: el detalle. RESPALDO: si la orden no tiene detalle
 * (la creó el contenedor anterior durante el traslape de un despliegue), se
 * dejan las columnas viejas del propio Order, que siempre están al día por la
 * escritura doble de PublicService.createOrder.
 *
 * TEMPORAL — el respaldo y la escritura doble se retiran en la Etapa 1b, junto
 * con las columnas viejas de Order.
 */
export function aRespuestaOrder<T extends { tipo?: unknown; detalleB2c?: DetalleB2C | null; huellaCheckout?: unknown }>(
  order: T,
): Omit<T, 'tipo' | 'detalleB2c' | 'huellaCheckout' | 'cancelado' | 'canceladoAt'> {
  // huellaCheckout (Parte B1) es interna del servidor — nunca viaja en la API ni en las salidas internas.
  // cancelado/canceladoAt (Etapa 2) son del módulo B2B: B2C no tiene cancelación y su contrato no cambia.
  const {
    tipo: _tipo,
    huellaCheckout: _huella,
    cancelado: _cancelado,
    canceladoAt: _canceladoAt,
    detalleB2c,
    ...resto
  } = order as T & { cancelado?: unknown; canceladoAt?: unknown };
  const base = sinOrdenEnItems(resto);
  if (!detalleB2c) {
    return base as Omit<T, 'tipo' | 'detalleB2c' | 'huellaCheckout' | 'cancelado' | 'canceladoAt'>;
  }
  const campos = Object.fromEntries(CAMPOS_DETALLE_B2C.map((campo) => [campo, detalleB2c[campo]]));
  return { ...base, ...campos } as Omit<T, 'tipo' | 'detalleB2c' | 'huellaCheckout' | 'cancelado' | 'canceladoAt'>;
}

/** `OrderItem.orden` (Etapa 2) solo lo puebla B2B: no se expone en los ítems de una orden B2C. */
function sinOrdenEnItems<R extends object>(resto: R): R {
  const items = (resto as { items?: unknown }).items;
  if (!Array.isArray(items)) return resto;
  return { ...resto, items: items.map(({ orden: _orden, ...item }) => item) };
}
