import { normalizar } from './normalizar';
import type { BaseSeed } from './db';

/**
 * Igualdad ESTRICTA de respuestas HTTP: conjunto exacto de claves + valores,
 * con ids y fechas normalizados (normalizar.ts). `toStrictEqual` falla si la
 * respuesta gana o pierde CUALQUIER campo respecto de la plantilla.
 *
 * `toMatchObject` queda reservado para aserciones sobre argumentos de mocks.
 */
export function expectExacto(
  actual: unknown,
  esperado: unknown,
  etiquetas: Record<string, string> = {},
): void {
  expect(normalizar(actual, etiquetas)).toStrictEqual(esperado);
}

/** Etiquetas estándar de un Order de `base` (tenant, order, cliente, productos). */
export function etiquetasOrder(
  base: BaseSeed,
  order?: { id: string; clienteId: string },
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    [base.tenant.id]: 'tenant',
    [base.productoA.id]: 'productoA',
    [base.productoB.id]: 'productoB',
    ...(order ? { [order.id]: 'order', [order.clienteId]: 'cliente' } : {}),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Plantillas base (ya normalizadas). Cada test declara solo lo que difiere.
// ---------------------------------------------------------------------------

/** `mod`: true cuando la respuesta incluye `modificadores` en cada item (checkout, avanzar). */
export function itemEsperado(overrides: Record<string, unknown> = {}, mod = false) {
  return {
    id: '<uuid>',
    tenantId: '<tenant>',
    orderId: '<order>',
    productId: '<productoA>',
    nombreProducto: 'Café americano',
    precioUnitario: '45',
    cantidad: 1,
    ...(mod ? { modificadores: [] } : {}),
    ...overrides,
  };
}

/** Order completo tal como lo serializa la API (EFECTIVO, RECOGER, lo antes posible, 1 × Café americano). */
export function ordenEsperada(overrides: Record<string, unknown> = {}, opts: { mod?: boolean } = {}) {
  return {
    id: '<order>',
    tenantId: '<tenant>',
    folio: '1',
    clienteNombre: 'Ana Prueba',
    clienteTelefono: '+52 55 1111 2222',
    clienteCorreo: null,
    clienteId: '<cliente>',
    notas: null,
    horaRecogidaTipo: 'LO_ANTES_POSIBLE',
    horaRecogida: null,
    metodoPago: 'EFECTIVO',
    estadoPago: 'PAGADO',
    stripePaymentIntentId: null,
    stripeRefundId: null,
    metodoEntrega: 'RECOGER',
    puntoEnvioId: null,
    direccionCalle: null,
    direccionNumero: null,
    direccionColonia: null,
    direccionReferencias: null,
    requiereFactura: false,
    facturaRazonSocial: null,
    facturaRfc: null,
    facturaRegimenFiscal: null,
    facturaUsoCfdi: null,
    facturaCodigoPostal: null,
    facturaCorreo: null,
    estadoPedido: 'PENDIENTE_CONFIRMACION',
    canalOrigen: 'WEB',
    descuentoTotal: '0',
    notasDescuento: null,
    total: '45',
    createdAt: '<iso>',
    updatedAt: '<iso>',
    items: [itemEsperado({}, opts.mod)],
    ...overrides,
  };
}

/** Fila de GET /clientes (todas las claves; fechas normalizadas). */
export function clienteEsperado(overrides: Record<string, unknown> = {}) {
  return {
    id: '<uuid>',
    tenantId: '<tenant>',
    canal: 'B2C',
    telefono: '5511112222',
    nombre: 'Ana Prueba',
    correo: null,
    primerPedidoAt: '<iso>',
    ultimoPedidoAt: '<iso>',
    totalPedidos: 1,
    createdAt: '<iso>',
    updatedAt: '<iso>',
    ...overrides,
  };
}

const NOMBRE_ERROR: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  500: 'Internal Server Error',
};

/**
 * Cuerpo de error COMPLETO: { message, error, statusCode } (401 de Passport
 * solo trae { message, statusCode }). Detecta si el refactor cambia el tipo
 * de excepción, no solo el mensaje.
 */
export function expectError(
  res: { status: number; body: unknown },
  status: number,
  message: string | string[],
): void {
  expect(res.status).toBe(status);
  if (status === 401) {
    expect(res.body).toStrictEqual({ message, statusCode: 401 });
    return;
  }
  expect(res.body).toStrictEqual({ message, error: NOMBRE_ERROR[status], statusCode: status });
}
