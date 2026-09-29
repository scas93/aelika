import request from 'supertest';
import Stripe from 'stripe';
import { tokenFor } from './auth';
import { conectarStripe } from './db';
import {
  auth,
  bodyCheckout,
  CLAVES_ITEM,
  CLAVES_MODIFICADOR_EN_ITEM,
  CLAVES_ORDER,
  crearPedidoTarjeta,
  eventoPaymentIntent,
  postCheckout,
  postWebhook,
  usarSuite,
} from './helpers';
import { waitForCalls } from './harness';
import { claves } from './normalizar';

// Área 6 · avanzar (cada transición + evento encolado) y reembolsar.
describe('B2C · avanzar', () => {
  const s = usarSuite();
  const dueno = () => auth(s.h, tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO'));

  async function crear(extra: Record<string, unknown> = {}) {
    const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, extra));
    expect(res.status).toBe(201);
    await waitForCalls(s.h.fakes.queueAdd); // PEDIDO_RECIBIDO
    s.h.fakes.reset();
    return res.body;
  }

  it('recorre las 3 transiciones; cada una encola su evento y dispara la regla ORDER; la 4ª es 409', async () => {
    const o = await crear({ clienteCorreo: 'ana@test.com' });
    const esperado = [
      ['CONFIRMADO_SURTIENDO', 'PEDIDO_CONFIRMADO'],
      ['LISTO_ENTREGA', 'PEDIDO_EN_CAMINO'],
      ['DESPACHADO', 'PEDIDO_ENTREGADO'],
    ] as const;

    for (const [i, [estado, evento]] of esperado.entries()) {
      const res = await dueno().patch(`/orders/${o.id}/avanzar`).expect(200);
      expect(claves(res.body)).toEqual(CLAVES_ORDER);
      expect(claves(res.body.items[0])).toEqual([...CLAVES_ITEM, 'modificadores'].sort());
      expect(res.body.estadoPedido).toBe(estado);

      await waitForCalls(s.h.fakes.queueAdd, i + 1);
      const [nombreJob, data] = s.h.fakes.queueAdd.mock.calls[i];
      expect(nombreJob).toBe('despachar');
      expect(Object.keys(data).sort()).toEqual(['destinatarioCliente', 'evento', 'mensaje', 'tenantId']);
      expect(data).toMatchObject({
        tenantId: s.base.tenant.id,
        evento,
        destinatarioCliente: 'ana@test.com',
        mensaje: {
          asunto: 'Tu pedido #1 — actualización',
          texto: `Tu pedido #1 cambió de estatus: ${evento}.`,
        },
      });
      expect(typeof data.mensaje.html).toBe('string');

      expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(i + 1);
      expect(s.h.fakes.dispararSeguro.mock.calls[i][0]).toMatchObject({
        tenantId: s.base.tenant.id,
        origen: 'ORDER',
        estatus: estado,
        clienteId: o.clienteId,
      });
    }

    const cuarto = await dueno().patch(`/orders/${o.id}/avanzar`).expect(409);
    expect(cuarto.body).toEqual({ message: 'Este pedido ya está despachado', error: 'Conflict', statusCode: 409 });
    expect(s.h.fakes.queueAdd).toHaveBeenCalledTimes(3);
    expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(3);
  });

  it('el modificador viaja en el item de la respuesta de avanzar (nombreGrupo, nombre, precioAdicional)', async () => {
    const { seedModificadores } = await import('./db');
    const { opciones } = await seedModificadores(s.h.prisma, s.base.tenant.id, s.base.productoA.id, {
      opciones: [{ nombre: 'Grande', precioAdicional: '30.00' }],
    });
    const o = await crear({ items: [{ productId: s.base.productoA.id, cantidad: 1, modifierOptionIds: [opciones[0].id] }] });
    const res = await dueno().patch(`/orders/${o.id}/avanzar`).expect(200);
    expect(claves(res.body.items[0].modificadores[0])).toEqual(CLAVES_MODIFICADOR_EN_ITEM);
    expect(res.body.items[0].modificadores[0]).toEqual({ nombreGrupo: 'Tamaño', nombre: 'Grande', precioAdicional: '30' });
  });

  it('destinatario del cliente: clienteCorreo, luego facturaCorreo como respaldo, o ninguno', async () => {
    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OPCIONAL' } });
    const factura = {
      requiereFactura: true,
      facturaRazonSocial: 'X SA',
      facturaRfc: 'XAXX010101000',
      facturaRegimenFiscal: '601',
      facturaUsoCfdi: 'G03',
      facturaCodigoPostal: '06000',
      facturaCorreo: 'factura@x.test',
    };
    const soloFactura = await crear(factura);
    await dueno().patch(`/orders/${soloFactura.id}/avanzar`).expect(200);
    await waitForCalls(s.h.fakes.queueAdd);
    expect(s.h.fakes.queueAdd.mock.calls[0][1].destinatarioCliente).toBe('factura@x.test');
    s.h.fakes.reset();

    const ambos = await crear({ ...factura, clienteCorreo: 'cliente@x.test', clienteTelefono: '5599990000' });
    await dueno().patch(`/orders/${ambos.id}/avanzar`).expect(200);
    await waitForCalls(s.h.fakes.queueAdd);
    expect(s.h.fakes.queueAdd.mock.calls[0][1].destinatarioCliente).toBe('cliente@x.test');
    s.h.fakes.reset();

    const ninguno = await crear({ clienteTelefono: '5588880000' });
    await dueno().patch(`/orders/${ninguno.id}/avanzar`).expect(200);
    await waitForCalls(s.h.fakes.queueAdd);
    expect(s.h.fakes.queueAdd.mock.calls[0][1].destinatarioCliente).toBeUndefined();
  });

  it('nunca acepta un estatus del body: siempre avanza al siguiente', async () => {
    const o = await crear();
    const res = await request(s.h.app.getHttpServer())
      .patch(`/orders/${o.id}/avanzar`)
      .set('Authorization', `Bearer ${tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO')}`)
      .send({ estadoPedido: 'DESPACHADO' })
      .expect(200);
    expect(res.body.estadoPedido).toBe('CONFIRMADO_SURTIENDO');
  });

  it('permisos: Operador, Gerente y Dueño pueden avanzar; sin token 401; id inexistente 404', async () => {
    const o = await crear();
    await auth(s.h, tokenFor(s.h.jwt, s.base.operador, s.base.tenant.id, 'OPERADOR')).patch(`/orders/${o.id}/avanzar`).expect(200);
    await auth(s.h, tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'GERENTE')).patch(`/orders/${o.id}/avanzar`).expect(200);
    await dueno().patch(`/orders/${o.id}/avanzar`).expect(200);
    await request(s.h.app.getHttpServer()).patch(`/orders/${o.id}/avanzar`).expect(401);
    const nf = await dueno().patch('/orders/00000000-0000-4000-8000-000000000000/avanzar').expect(404);
    expect(nf.body.message).toBe('Pedido no encontrado');
  });

  it('BUG CONGELADO: se puede avanzar un pedido TARJETA cuyo pago está PENDIENTE (no se revisa estadoPago)', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const { order } = await crearPedidoTarjeta(s.h, s.base);
    expect(order.estadoPago).toBe('PENDIENTE');
    const res = await dueno().patch(`/orders/${order.id}/avanzar`).expect(200);
    expect(res.body).toMatchObject({ estadoPedido: 'CONFIRMADO_SURTIENDO', estadoPago: 'PENDIENTE' });
  });
});

describe('B2C · reembolsar', () => {
  const s = usarSuite();
  const dueno = () => auth(s.h, tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO'));

  async function pedidoPagadoConTarjeta() {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const { order, piId } = await crearPedidoTarjeta(s.h, s.base);
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
    return { order, piId };
  }

  it('caso válido: reembolso total, reverse_transfer, estadoPago REEMBOLSADO + stripeRefundId', async () => {
    const { order, piId } = await pedidoPagadoConTarjeta();
    const res = await dueno().post(`/orders/${order.id}/reembolsar`).expect(201);
    expect(claves(res.body)).toEqual(CLAVES_ORDER);
    expect(claves(res.body.items[0])).toEqual(CLAVES_ITEM); // aquí el include es items:true (sin modificadores)
    expect(res.body).toMatchObject({ estadoPago: 'REEMBOLSADO', stripeRefundId: 're_char_1', metodoPago: 'TARJETA' });
    expect(s.h.fakes.refundsCreate).toHaveBeenCalledTimes(1);
    expect(s.h.fakes.refundsCreate).toHaveBeenCalledWith({ payment_intent: piId, reverse_transfer: true });
  });

  it('Operador también puede reembolsar (sin @Roles)', async () => {
    const { order } = await pedidoPagadoConTarjeta();
    await auth(s.h, tokenFor(s.h.jwt, s.base.operador, s.base.tenant.id, 'OPERADOR')).post(`/orders/${order.id}/reembolsar`).expect(201);
  });

  it('rechaza pedidos que no son TARJETA + PAGADO (409) sin llamar a Stripe', async () => {
    const msg = 'Solo se pueden reembolsar pedidos pagados con tarjeta y en estado Pagado';
    // EFECTIVO
    const efectivo = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    const r1 = await dueno().post(`/orders/${efectivo.body.id}/reembolsar`).expect(409);
    expect(r1.body).toEqual({ message: msg, error: 'Conflict', statusCode: 409 });

    // TARJETA pendiente
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const pendiente = await crearPedidoTarjeta(s.h, s.base, { clienteTelefono: '5511110001' });
    await dueno().post(`/orders/${pendiente.order.id}/reembolsar`).expect(409);

    // TARJETA fallida
    const fallida = await crearPedidoTarjeta(s.h, s.base, { clienteTelefono: '5511110002' });
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.payment_failed', fallida.piId, 4500)).expect(200);
    await dueno().post(`/orders/${fallida.order.id}/reembolsar`).expect(409);

    expect(s.h.fakes.refundsCreate).not.toHaveBeenCalled();
  });

  it('segundo reembolso del mismo pedido: 409', async () => {
    const { order } = await pedidoPagadoConTarjeta();
    await dueno().post(`/orders/${order.id}/reembolsar`).expect(201);
    await dueno().post(`/orders/${order.id}/reembolsar`).expect(409);
    expect(s.h.fakes.refundsCreate).toHaveBeenCalledTimes(1);
  });

  it('Stripe balance_insufficient: 409 con mensaje propio y el pedido queda intacto', async () => {
    const { order } = await pedidoPagadoConTarjeta();
    s.h.fakes.refundsCreate.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({ type: 'invalid_request_error', code: 'balance_insufficient', message: 'sin saldo' } as any),
    );
    const res = await dueno().post(`/orders/${order.id}/reembolsar`).expect(409);
    expect(res.body).toEqual({
      message: 'El negocio no tiene saldo suficiente para esta devolución.',
      error: 'Conflict',
      statusCode: 409,
    });
    const fila = await s.h.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fila).toMatchObject({ estadoPago: 'PAGADO', stripeRefundId: null });
  });

  it('cualquier otro error de Stripe: 500 con mensaje genérico y el pedido queda intacto', async () => {
    const { order } = await pedidoPagadoConTarjeta();
    s.h.fakes.refundsCreate.mockRejectedValueOnce(new Error('boom'));
    const res = await dueno().post(`/orders/${order.id}/reembolsar`).expect(500);
    expect(res.body).toEqual({
      message: 'No se pudo procesar la devolución. Intenta de nuevo más tarde.',
      error: 'Internal Server Error',
      statusCode: 500,
    });
    expect((await s.h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).estadoPago).toBe('PAGADO');
  });

  it('404 si el pedido no existe; 401 sin token', async () => {
    const nf = await dueno().post('/orders/00000000-0000-4000-8000-000000000000/reembolsar').expect(404);
    expect(nf.body.message).toBe('Pedido no encontrado');
    await request(s.h.app.getHttpServer()).post('/orders/00000000-0000-4000-8000-000000000000/reembolsar').expect(401);
  });
});
