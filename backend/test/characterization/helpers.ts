import request from 'supertest';
import { Harness, WEBHOOK_SECRET_V1 } from './harness';
import { BaseSeed } from './db';

export const AHORA = '2026-09-30T16:00:00.000Z'; // miércoles 10:00 CDMX (UTC-6)

/** Body mínimo válido de checkout (EFECTIVO, RECOGER, lo antes posible, 1 x productoA). */
export function bodyCheckout(base: BaseSeed, extra: Record<string, unknown> = {}) {
  return {
    clienteNombre: 'Ana Prueba',
    clienteTelefono: '+52 55 1111 2222',
    metodoPago: 'EFECTIVO',
    horaRecogidaTipo: 'LO_ANTES_POSIBLE',
    items: [{ productId: base.productoA.id, cantidad: 1 }],
    ...extra,
  };
}

export function postCheckout(h: Harness, slug: string, body: Record<string, unknown>) {
  return request(h.app.getHttpServer()).post(`/public/tenants/${slug}/orders`).send(body);
}

export function auth(h: Harness, token: string) {
  const s = h.app.getHttpServer();
  return {
    get: (url: string) => request(s).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body?: object) => request(s).post(url).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string) => request(s).patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => request(s).delete(url).set('Authorization', `Bearer ${token}`),
  };
}

/** Evento clásico de Stripe (PaymentIntent) mínimo pero con la forma real. */
export function eventoPaymentIntent(
  tipo: 'payment_intent.processing' | 'payment_intent.succeeded' | 'payment_intent.payment_failed',
  piId: string,
  amountCentavos: number,
) {
  return {
    id: `evt_${tipo.replace(/\W/g, '_')}_${piId}`,
    object: 'event',
    api_version: '2024-06-20',
    created: 1790000000,
    type: tipo,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: {
      object: {
        id: piId,
        object: 'payment_intent',
        amount: amountCentavos,
        currency: 'mxn',
        created: 1790000000,
        payment_method_types: ['card'],
        status: tipo === 'payment_intent.succeeded' ? 'succeeded' : 'processing',
      },
    },
  };
}

/**
 * POST /webhooks/stripe con el cuerpo crudo firmado (HMAC real, mismo
 * generador que usa Stripe) con el secreto de prueba: ejerce la ruta real de
 * verificación de firma.
 */
export function postWebhook(h: Harness, evento: object, opts: { secreto?: string; sinFirma?: boolean } = {}) {
  const payload = JSON.stringify(evento);
  const req = request(h.app.getHttpServer())
    .post('/webhooks/stripe')
    .set('Content-Type', 'application/json');
  if (!opts.sinFirma) {
    const firma = h.stripe.webhooks.generateTestHeaderString({
      payload,
      secret: opts.secreto ?? WEBHOOK_SECRET_V1,
    });
    req.set('stripe-signature', firma);
  }
  return req.send(payload);
}

/** Crea un pedido TARJETA y devuelve { order, piId }. Requiere conectarStripe antes. */
export async function crearPedidoTarjeta(h: Harness, base: BaseSeed, extra: Record<string, unknown> = {}) {
  const res = await postCheckout(h, base.tenant.slug, bodyCheckout(base, { metodoPago: 'TARJETA', ...extra }));
  if (res.status !== 201) throw new Error(`crearPedidoTarjeta: ${res.status} ${JSON.stringify(res.body)}`);
  return { order: res.body, piId: res.body.stripePaymentIntentId as string };
}

/** Deja que terminen las tareas fire-and-forget ya iniciadas (cede el event loop). */
export async function cederEventLoop(vueltas = 20) {
  for (let i = 0; i < vueltas; i++) await new Promise<void>((r) => setImmediate(r));
}

export const CLAVES_ORDER = [
  'canalOrigen',
  'clienteCorreo',
  'clienteId',
  'clienteNombre',
  'clienteTelefono',
  'createdAt',
  'descuentoTotal',
  'direccionCalle',
  'direccionColonia',
  'direccionNumero',
  'direccionReferencias',
  'estadoPago',
  'estadoPedido',
  'facturaCodigoPostal',
  'facturaCorreo',
  'facturaRazonSocial',
  'facturaRegimenFiscal',
  'facturaRfc',
  'facturaUsoCfdi',
  'folio',
  'horaRecogida',
  'horaRecogidaTipo',
  'id',
  'items',
  'metodoEntrega',
  'metodoPago',
  'notas',
  'notasDescuento',
  'puntoEnvioId',
  'requiereFactura',
  'stripePaymentIntentId',
  'stripeRefundId',
  'tenantId',
  'total',
  'updatedAt',
];

export const CLAVES_ITEM = ['cantidad', 'id', 'nombreProducto', 'orderId', 'precioUnitario', 'productId', 'tenantId'];
export const CLAVES_MODIFICADOR_EN_ITEM = ['nombre', 'nombreGrupo', 'precioAdicional'];

// ---------------------------------------------------------------------------
// Scaffold común de cada archivo de la suite.
// ---------------------------------------------------------------------------
import { createHarness, freezeClock, restoreClock } from './harness';
import { seedBase, truncateAll } from './db';

export interface Suite {
  h: Harness;
  base: BaseSeed;
}

/** beforeAll/afterAll/beforeEach estándar: app, reloj fijo, base limpia + datos base. */
export function usarSuite(opts: { seed?: Parameters<typeof seedBase>[1] } = {}): Suite {
  const ctx = {} as Suite;
  beforeAll(async () => {
    freezeClock(AHORA);
    ctx.h = await createHarness();
  });
  afterAll(async () => {
    await ctx.h.close();
    restoreClock();
  });
  beforeEach(async () => {
    jest.setSystemTime(new Date(AHORA));
    await truncateAll(ctx.h.prisma);
    ctx.h.fakes.reset();
    ctx.base = await seedBase(ctx.h.prisma, opts.seed);
  });
  return ctx;
}
