import { Logger } from '@nestjs/common';
import { tokenFor } from './auth';
import { conectarStripe, seedPuntoEnvio } from './db';
import { etiquetasOrder, expectError, expectExacto, ordenEsperada } from './exacto';
import { auth, bodyCheckout, cederEventLoop, crearPedidoTarjeta, eventoPaymentIntent, postCheckout, postWebhook, usarSuite } from './helpers';
import { waitForCalls } from './harness';

// Etapa 1b-a · ORDEN SIN DetalleB2C (inconsistencia de datos). Antes (Etapa 1) una orden sin detalle se leía de las
// columnas viejas de Order (respaldo de lectura). Desde la 1b-a ese respaldo no existe y las columnas viejas ya no se
// escriben, así que NUNCA se inventan valores: lectura individual → 500 con log (id de la orden); listas → la orden se
// omite con log de error; y las acciones con efectos (avanzar, reembolsar) fallan ANTES de cambiar nada.
// Setup: checkout normal + borrar su fila de detalles_b2c.
describe('B2C · orden sin DetalleB2C (Etapa 1b-a: sin respaldo de lectura)', () => {
  const s = usarSuite();
  const dueno = () => auth(s.h, tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO'));
  let logError: jest.SpyInstance;
  beforeEach(() => {
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => logError.mockRestore());

  const sinDetalle = async (orderId: string) => {
    await s.h.prisma.detalleB2C.deleteMany({ where: { orderId } });
    expect(await s.h.prisma.detalleB2C.count({ where: { orderId } })).toBe(0); // la prueba es significativa
  };
  // 500 genérico de Nest (InternalServerErrorException sin mensaje propio): nada del detalle faltante se filtra al cliente.
  const expect500 = (res: { status: number; body: unknown }) => {
    expect(res.status).toBe(500);
    expect(res.body).toStrictEqual({ statusCode: 500, message: 'Internal Server Error' });
  };
  const logsConId = (orderId: string) => logError.mock.calls.filter(([m]) => String(m).includes(orderId));

  it('findOne: 500 genérico (sin valores inventados) y log de error con el id de la orden', async () => {
    const creada = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    expect(creada.status).toBe(201);
    await waitForCalls(s.h.fakes.queueAdd);
    await sinDetalle(creada.body.id);

    expect500(await dueno().get(`/orders/${creada.body.id}`));
    expect(logsConId(creada.body.id)).toHaveLength(1);
  });

  it('findAll con lista mixta (una con detalle, dos sin): las dos sin detalle se omiten con log de error; la otra sale idéntica', async () => {
    const con = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: '5500000001' }));
    const sin1 = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: '5500000002' }));
    const sin2 = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: '5500000003' }));
    await waitForCalls(s.h.fakes.queueAdd, 3);
    await sinDetalle(sin1.body.id);
    await sinDetalle(sin2.body.id);
    expect(await s.h.prisma.detalleB2C.count()).toBe(1);

    const res = await dueno().get('/orders').expect(200);
    expect(res.body.map((o: { id: string }) => o.id)).toStrictEqual([con.body.id]);
    const et = { ...etiquetasOrder(s.base, res.body[0]) };
    expectExacto(res.body[0], ordenEsperada({ clienteTelefono: '5500000001' }), et);
    expect(logsConId(sin1.body.id)).toHaveLength(1);
    expect(logsConId(sin2.body.id)).toHaveLength(1);
    expect(logsConId(con.body.id)).toHaveLength(0);
  });

  it('avanzar: 500 con log y el estatus NO cambia (falla antes de actualizar; no se dispara el contexto de reglas)', async () => {
    const creada = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    await waitForCalls(s.h.fakes.queueAdd);
    await sinDetalle(creada.body.id);

    expect500(await dueno().patch(`/orders/${creada.body.id}/avanzar`));
    const fila = await s.h.prisma.order.findUniqueOrThrow({ where: { id: creada.body.id } });
    expect(fila.estadoPedido).toBe('PENDIENTE_CONFIRMACION');
    expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
    expect(logsConId(creada.body.id)).toHaveLength(1);
  });

  it('reembolsar: 500 con log ANTES de llamar a Stripe; el pedido sigue PAGADO', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const { order, piId } = await crearPedidoTarjeta(s.h, s.base);
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
    await waitForCalls(s.h.fakes.queueAdd, 2);
    await sinDetalle(order.id);

    expect500(await dueno().post(`/orders/${order.id}/reembolsar`));
    expect(s.h.fakes.refundsCreate).not.toHaveBeenCalled();
    const fila = await s.h.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fila.estadoPago).toBe('PAGADO');
    expect(logsConId(order.id)).toHaveLength(1);
  });

  it('recibo de Telegram vía webhook: el pago se procesa (200) pero no se encola recibo y queda un log de error con el id', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const { order, piId } = await crearPedidoTarjeta(s.h, s.base, { horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '10:30' });
    await sinDetalle(order.id);
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
    await cederEventLoop();

    const fila = await s.h.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(fila.estadoPago).toBe('PAGADO'); // el pago sí se registra
    const recibos = s.h.fakes.queueAdd.mock.calls.map(([, d]) => d).filter((d) => d?.evento === 'PEDIDO_RECIBIDO');
    expect(recibos).toHaveLength(0);
    expect(logsConId(order.id).length).toBeGreaterThanOrEqual(1);
  });

  it('borrar un punto de envío da 409 cuando el punto solo tiene órdenes NUEVAS (columna vieja puntoEnvioId en null; la FK es la del detalle)', async () => {
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
    const creada = await postCheckout(
      s.h,
      s.base.tenant.slug,
      bodyCheckout(s.base, {
        metodoEntrega: 'DOMICILIO',
        puntoEnvioId: punto.id,
        direccionCalle: 'Calle Roble',
        direccionNumero: '12-B',
        direccionColonia: 'Del Valle',
      }),
    );
    expect(creada.status).toBe(201);
    await waitForCalls(s.h.fakes.queueAdd);
    const fila = await s.h.prisma.order.findUniqueOrThrow({ where: { id: creada.body.id } });
    expect(fila.puntoEnvioId).toBeNull(); // la orden vieja-columna ya no referencia al punto
    expectError(await dueno().delete(`/puntos-envio/${punto.id}`), 409, 'No puedes eliminar un punto de envío que tiene pedidos');
    await cederEventLoop();
  });
});
