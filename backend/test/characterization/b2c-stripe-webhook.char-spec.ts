import request from 'supertest';
import { conectarStripe, seedBase } from './db';
import { bodyCheckout, cederEventLoop, crearPedidoTarjeta, eventoPaymentIntent, postCheckout, postWebhook, usarSuite } from './helpers';
import { waitForCalls } from './harness';
import { claves, normalizar } from './normalizar';

// Área 7 · Webhook de Stripe v1 firmado (cuerpo crudo + HMAC real) y getEstadoPago público.
describe('B2C · webhook de Stripe (payment_intent.*)', () => {
  const s = usarSuite();

  async function pedido(extra: Record<string, unknown> = {}) {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const { order, piId } = await crearPedidoTarjeta(s.h, s.base, extra);
    return { order, piId };
  }
  const estado = async (id: string) => (await s.h.prisma.order.findUniqueOrThrow({ where: { id } })).estadoPago;
  const evento = (tipo: Parameters<typeof eventoPaymentIntent>[0], piId: string) => eventoPaymentIntent(tipo, piId, 4500);

  it('PENDIENTE → PROCESANDO: solo actualiza estadoPago, sin Payment ni notificaciones', async () => {
    const { order, piId } = await pedido();
    const res = await postWebhook(s.h, evento('payment_intent.processing', piId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(await estado(order.id)).toBe('PROCESANDO');
    await cederEventLoop();
    expect(await s.h.prisma.payment.count()).toBe(0);
    expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
  });

  it('PROCESANDO → PAGADO: crea el Payment y encola PAGO_CONFIRMADO y PEDIDO_RECIBIDO', async () => {
    const { order, piId } = await pedido();
    await postWebhook(s.h, evento('payment_intent.processing', piId)).expect(200);
    await postWebhook(s.h, evento('payment_intent.succeeded', piId)).expect(200);
    expect(await estado(order.id)).toBe('PAGADO');

    const pagos = await s.h.prisma.payment.findMany();
    expect(pagos).toHaveLength(1);
    expect(
      normalizar(pagos[0], { [s.base.tenant.id]: 'tenant', [order.id]: 'order' }),
    ).toEqual({
      id: pagos[0].id, // cuid (no UUID): no determinístico
      tenantId: '<tenant>',
      orderId: '<order>',
      stripePaymentIntentId: piId,
      amount: '45',
      currency: 'mxn',
      status: 'PAGADO',
      paymentMethodType: 'card',
      cardBrand: null,
      last4: null,
      capturedAt: '<iso>',
      createdAt: '<iso>',
    });
    expect(pagos[0].capturedAt!.toISOString()).toBe(new Date(1790000000 * 1000).toISOString());

    await waitForCalls(s.h.fakes.queueAdd, 2);
    const eventos = s.h.fakes.queueAdd.mock.calls.map(([, d]) => d.evento).sort();
    expect(eventos).toEqual(['PAGO_CONFIRMADO', 'PEDIDO_RECIBIDO']);
    const pagoConfirmado = s.h.fakes.queueAdd.mock.calls.find(([, d]) => d.evento === 'PAGO_CONFIRMADO')![1];
    expect(pagoConfirmado).toEqual({
      tenantId: s.base.tenant.id,
      evento: 'PAGO_CONFIRMADO',
      mensaje: { asunto: 'Pago confirmado — pedido #1', texto: 'Se confirmó el pago del pedido #1 por $45.00.' },
    });
    const recibido = s.h.fakes.queueAdd.mock.calls.find(([, d]) => d.evento === 'PEDIDO_RECIBIDO')![1];
    expect(recibido.mensaje.asunto).toBe('Nuevo pedido #1');
    expect(recibido.mensaje.texto).toContain('✅ PAGADO CON TARJETA');
  });

  it('idempotencia: repetir "succeeded" no duplica Payment ni notificaciones', async () => {
    const { piId } = await pedido();
    await postWebhook(s.h, evento('payment_intent.succeeded', piId)).expect(200);
    await waitForCalls(s.h.fakes.queueAdd, 2);
    await postWebhook(s.h, evento('payment_intent.succeeded', piId)).expect(200);
    await cederEventLoop();
    expect(await s.h.prisma.payment.count()).toBe(1);
    expect(s.h.fakes.queueAdd).toHaveBeenCalledTimes(2);
  });

  it('PENDIENTE → FALLIDO: crea Payment FALLIDO y NO notifica nada', async () => {
    const { order, piId } = await pedido();
    await postWebhook(s.h, evento('payment_intent.payment_failed', piId)).expect(200);
    expect(await estado(order.id)).toBe('FALLIDO');
    const pagos = await s.h.prisma.payment.findMany();
    expect(pagos.map((p) => p.status)).toEqual(['FALLIDO']);
    await cederEventLoop();
    expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
  });

  it('FALLIDO y luego un intento exitoso: queda PAGADO con dos filas de Payment (historial de intentos)', async () => {
    const { order, piId } = await pedido();
    await postWebhook(s.h, evento('payment_intent.payment_failed', piId)).expect(200);
    await postWebhook(s.h, evento('payment_intent.succeeded', piId)).expect(200);
    expect(await estado(order.id)).toBe('PAGADO');
    expect((await s.h.prisma.payment.findMany({ orderBy: { createdAt: 'asc' } })).map((p) => p.status).sort()).toEqual(['FALLIDO', 'PAGADO']);
    await waitForCalls(s.h.fakes.queueAdd, 2);
  });

  it('un "payment_failed" tardío no regresa un pago exitoso a FALLIDO (ni crea Payment)', async () => {
    const { order, piId } = await pedido();
    await postWebhook(s.h, evento('payment_intent.succeeded', piId)).expect(200);
    await waitForCalls(s.h.fakes.queueAdd, 2);
    await postWebhook(s.h, evento('payment_intent.payment_failed', piId)).expect(200);
    expect(await estado(order.id)).toBe('PAGADO');
    expect(await s.h.prisma.payment.count()).toBe(1);
  });

  it('un "processing" tardío no regresa un pedido ya resuelto a PROCESANDO', async () => {
    const { order, piId } = await pedido();
    await postWebhook(s.h, evento('payment_intent.succeeded', piId)).expect(200);
    await postWebhook(s.h, evento('payment_intent.processing', piId)).expect(200);
    expect(await estado(order.id)).toBe('PAGADO');
  });

  it('PaymentIntent que no pertenece a ningún pedido: 200 y sin efectos', async () => {
    const res = await postWebhook(s.h, evento('payment_intent.succeeded', 'pi_ajeno'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    await cederEventLoop();
    expect(await s.h.prisma.payment.count()).toBe(0);
    expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
  });

  it('tipos de evento que no maneja se aceptan con 200 y no cambian nada', async () => {
    const { order, piId } = await pedido();
    const res = await postWebhook(s.h, { ...evento('payment_intent.succeeded', piId), type: 'charge.succeeded' });
    expect(res.status).toBe(200);
    expect(await estado(order.id)).toBe('PENDIENTE');
  });

  describe('verificación de firma', () => {
    it('sin cabecera stripe-signature: 400', async () => {
      const res = await postWebhook(s.h, evento('payment_intent.succeeded', 'pi_x'), { sinFirma: true });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Falta la firma del webhook', error: 'Bad Request', statusCode: 400 });
    });

    it('firma con un secreto equivocado: 400 y el pedido no cambia', async () => {
      const { order, piId } = await pedido();
      const res = await postWebhook(s.h, evento('payment_intent.succeeded', piId), { secreto: 'whsec_otro' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: 'Firma de webhook inválida', error: 'Bad Request', statusCode: 400 });
      expect(await estado(order.id)).toBe('PENDIENTE');
    });
  });

  describe('EFECTIVO no pasa por el webhook', () => {
    it('nace PAGADO y un evento con su id inexistente no lo toca', async () => {
      const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      expect(res.body).toMatchObject({ estadoPago: 'PAGADO', stripePaymentIntentId: null });
      await waitForCalls(s.h.fakes.queueAdd);
    });
  });
});

describe('B2C · GET /public/tenants/:slug/orders/:id/estado-pago', () => {
  const s = usarSuite();
  const url = (slug: string, id: string) => `/public/tenants/${slug}/orders/${id}/estado-pago`;

  it('expone únicamente { estadoPago } y sigue el ciclo del pago', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const { order, piId } = await crearPedidoTarjeta(s.h, s.base);
    const get = () => request(s.h.app.getHttpServer()).get(url(s.base.tenant.slug, order.id));

    let res = await get().expect(200);
    expect(res.body).toEqual({ estadoPago: 'PENDIENTE' });
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.processing', piId, 4500)).expect(200);
    expect((await get().expect(200)).body).toEqual({ estadoPago: 'PROCESANDO' });
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
    res = await get().expect(200);
    expect(res.body).toEqual({ estadoPago: 'PAGADO' });
    expect(claves(res.body)).toEqual(['estadoPago']);
    await waitForCalls(s.h.fakes.queueAdd, 2);
  });

  it('es público (sin JWT) y da 404 con el slug de otro tenant o un id inexistente', async () => {
    const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
    const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    await waitForCalls(s.h.fakes.queueAdd);
    await request(s.h.app.getHttpServer()).get(url(s.base.tenant.slug, res.body.id)).expect(200);

    const otroTenant = await request(s.h.app.getHttpServer()).get(url(otro.tenant.slug, res.body.id)).expect(404);
    expect(otroTenant.body).toEqual({ message: 'Pedido no encontrado', error: 'Not Found', statusCode: 404 });
    await request(s.h.app.getHttpServer()).get(url(s.base.tenant.slug, '00000000-0000-4000-8000-000000000000')).expect(404);
    const sinNegocio = await request(s.h.app.getHttpServer()).get(url('no-existe', res.body.id)).expect(404);
    expect(sinNegocio.body.message).toBe('Negocio no encontrado');
  });
});
