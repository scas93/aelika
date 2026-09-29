import { tokenFor } from './auth';
import { conectarStripe, seedPromocion, seedPuntoEnvio } from './db';
import { etiquetasOrder, expectExacto, expectError, itemEsperado, ordenEsperada } from './exacto';
import {
  auth,
  bodyCheckout,
  cederEventLoop,
  crearPedidoTarjeta,
  eventoPaymentIntent,
  postCheckout,
  postWebhook,
  usarSuite,
} from './helpers';
import { waitForCalls } from './harness';

// Etapa 1 · RESPALDO DE LECTURA: una orden SIN fila en detalles_b2c (la creó el contenedor anterior durante
// el traslape de un despliegue) debe leerse IGUAL por todos los endpoints y salidas, tomando los campos B2C
// de las columnas viejas de Order (siempre al día por la escritura doble). Setup: checkout normal + borrar
// su fila de detalles_b2c. TEMPORAL — se retira en la Etapa 1b junto con el respaldo.
describe('B2C · orden sin DetalleB2C (respaldo de lectura, Etapa 1)', () => {
  const s = usarSuite();
  const dueno = () => auth(s.h, tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO'));

  const sinDetalle = async (orderId: string) => {
    await s.h.prisma.detalleB2C.deleteMany({ where: { orderId } });
    expect(await s.h.prisma.detalleB2C.count({ where: { orderId } })).toBe(0); // la prueba es significativa
  };

  const domicilio = (punto: string, extra: Record<string, unknown> = {}) => ({
    metodoEntrega: 'DOMICILIO',
    puntoEnvioId: punto,
    direccionCalle: 'Calle Roble',
    direccionNumero: '12-B',
    direccionColonia: 'Del Valle',
    direccionReferencias: 'Portón azul',
    items: [{ productId: s.base.productoA.id, cantidad: 2 }],
    ...extra,
  });
  const esperadoDomicilio = (overrides: Record<string, unknown> = {}, mod = false) =>
    ordenEsperada(
      {
        metodoEntrega: 'DOMICILIO',
        puntoEnvioId: '<punto>',
        direccionCalle: 'Calle Roble',
        direccionNumero: '12-B',
        direccionColonia: 'Del Valle',
        direccionReferencias: 'Portón azul',
        descuentoTotal: '9',
        notasDescuento: 'Café americano x2 (-10%)',
        total: '81',
        items: [itemEsperado({ cantidad: 2 }, mod)],
        ...overrides,
      },
      { mod },
    );
  const promo = () =>
    seedPromocion(s.h.prisma, s.base.tenant.id, 'DESCUENTO_PRODUCTO', {
      productId: s.base.productoA.id,
      tipoDescuento: 'porcentaje',
      valor: 10,
    });

  it('findOne: idéntico a una orden con detalle (entrega, dirección, punto de envío y notasDescuento)', async () => {
    await promo();
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
    const creada = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, domicilio(punto.id)));
    expect(creada.status).toBe(201);
    await waitForCalls(s.h.fakes.queueAdd);
    await sinDetalle(creada.body.id);

    const res = await dueno().get(`/orders/${creada.body.id}`).expect(200);
    expectExacto(res.body, esperadoDomicilio(), etiquetasOrder(s.base, res.body, { [punto.id]: 'punto' }));
  });

  it('findAll con lista mixta (una con detalle, dos sin): todas con la misma forma y valores', async () => {
    await promo();
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
    const con = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, domicilio(punto.id, { clienteTelefono: '5500000001' })));
    const sin1 = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, domicilio(punto.id, { clienteTelefono: '5500000002' })));
    const sin2 = await postCheckout(
      s.h,
      s.base.tenant.slug,
      bodyCheckout(s.base, { clienteTelefono: '5500000003', horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '10:45' }),
    );
    await waitForCalls(s.h.fakes.queueAdd, 3);
    await sinDetalle(sin1.body.id);
    await sinDetalle(sin2.body.id);
    expect(await s.h.prisma.detalleB2C.count()).toBe(1);

    const res = await dueno().get('/orders').expect(200);
    expect(res.body.map((o: any) => o.folio)).toStrictEqual(['3', '2', '1']);
    const et = { ...etiquetasOrder(s.base), [punto.id]: 'punto' };
    for (const o of res.body) {
      et[o.id] = `order${o.folio}`;
      et[o.clienteId] = `cliente${o.folio}`;
    }
    const conv = (folio: string, base: Record<string, unknown>) => ({ ...base, id: `<order${folio}>`, folio, clienteId: `<cliente${folio}>`, items: [{ ...(base.items as any[])[0], orderId: `<order${folio}>` }] });
    expectExacto(
      res.body,
      [
        conv(
          '3',
          ordenEsperada({
            clienteTelefono: '5500000003',
            horaRecogidaTipo: 'HORA_ESPECIFICA',
            horaRecogida: '10:45',
            descuentoTotal: '4.5', // la promoción de Café americano aplica también a esta orden (cantidad 1)
            notasDescuento: 'Café americano x1 (-10%)',
            total: '40.5',
          }),
        ),
        conv('2', { ...esperadoDomicilio({ clienteTelefono: '5500000002' }) }),
        conv('1', { ...esperadoDomicilio({ clienteTelefono: '5500000001' }) }),
      ],
      et,
    );
    expect(con.status).toBe(201);
  });

  it('avanzar: respuesta y contexto de reglas ORDER (entrega/dirección) idénticos', async () => {
    await promo();
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
    const creada = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, domicilio(punto.id)));
    await waitForCalls(s.h.fakes.queueAdd);
    await sinDetalle(creada.body.id);

    const res = await dueno().patch(`/orders/${creada.body.id}/avanzar`).expect(200);
    expectExacto(
      res.body,
      esperadoDomicilio({ estadoPedido: 'CONFIRMADO_SURTIENDO' }, true),
      etiquetasOrder(s.base, res.body, { [punto.id]: 'punto' }),
    );
    const ctx = s.h.fakes.dispararSeguro.mock.calls[0][0].contexto;
    expect({
      metodoEntrega: ctx.metodoEntrega,
      direccionCalle: ctx.direccionCalle,
      direccionNumero: ctx.direccionNumero,
      direccionColonia: ctx.direccionColonia,
      metodoPago: ctx.metodoPago,
    }).toStrictEqual({
      metodoEntrega: 'DOMICILIO',
      direccionCalle: 'Calle Roble',
      direccionNumero: '12-B',
      direccionColonia: 'Del Valle',
      metodoPago: 'EFECTIVO',
    });
  });

  it('reembolsar (TARJETA + DOMICILIO): respuesta exacta idéntica', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
    const { order, piId } = await crearPedidoTarjeta(s.h, s.base, {
      metodoEntrega: 'DOMICILIO',
      puntoEnvioId: punto.id,
      direccionCalle: 'Calle Roble',
      direccionNumero: '12-B',
      direccionColonia: 'Del Valle',
      direccionReferencias: 'Portón azul',
    });
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
    await waitForCalls(s.h.fakes.queueAdd, 2);
    await sinDetalle(order.id);

    const res = await dueno().post(`/orders/${order.id}/reembolsar`).expect(201);
    expectExacto(
      res.body,
      ordenEsperada({
        metodoPago: 'TARJETA',
        estadoPago: 'REEMBOLSADO',
        stripePaymentIntentId: 'pi_char_1',
        stripeRefundId: 're_char_1',
        metodoEntrega: 'DOMICILIO',
        puntoEnvioId: '<punto>',
        direccionCalle: 'Calle Roble',
        direccionNumero: '12-B',
        direccionColonia: 'Del Valle',
        direccionReferencias: 'Portón azul',
      }),
      etiquetasOrder(s.base, order, { [punto.id]: 'punto' }),
    );
  });

  it('recibo de Telegram vía webhook (TARJETA + hora específica): "Llega en" sale de la columna vieja', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const { order, piId } = await crearPedidoTarjeta(s.h, s.base, { horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '10:30' });
    await sinDetalle(order.id);
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
    await waitForCalls(s.h.fakes.queueAdd, 2);
    const recibo = s.h.fakes.queueAdd.mock.calls.map(([, d]) => d).find((d) => d.evento === 'PEDIDO_RECIBIDO')!;
    expect(recibo.mensaje.texto).toContain('Llega en: 10:30');
    expect(recibo.mensaje.texto).toContain('✅ PAGADO CON TARJETA');
  });

  it('borrar un punto de envío sigue dando 409 aunque la orden no tenga detalle (FK de la columna vieja)', async () => {
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
    const creada = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, domicilio(punto.id)));
    await waitForCalls(s.h.fakes.queueAdd);
    await sinDetalle(creada.body.id);
    expectError(await dueno().delete(`/puntos-envio/${punto.id}`), 409, 'No puedes eliminar un punto de envío que tiene pedidos');
    await cederEventLoop();
  });
});
