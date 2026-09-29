import { tokenFor } from './auth';
import { conectarStripe, seedPuntoEnvio } from './db';
import { etiquetasOrder, expectExacto, itemEsperado, ordenEsperada } from './exacto';
import { auth, crearPedidoTarjeta, eventoPaymentIntent, postWebhook, usarSuite } from './helpers';

// Etapa 1 · GET/POST reembolsar con campos B2C no default (antes sin cobertura). Respuesta exacta.
describe('B2C · reembolsar con campos de entrega/hora (Etapa 1)', () => {
  const s = usarSuite();
  const dueno = () => auth(s.h, tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO'));

  it('(a) TARJETA + DOMICILIO con dirección y punto de envío', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id, { nombre: 'Zona Centro' });
    const { order, piId } = await crearPedidoTarjeta(s.h, s.base, {
      metodoEntrega: 'DOMICILIO',
      puntoEnvioId: punto.id,
      direccionCalle: 'Calle Roble',
      direccionNumero: '12-B',
      direccionColonia: 'Del Valle',
      direccionReferencias: 'Portón azul',
    });
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);

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

  it('(b) TARJETA + RECOGER con hora específica', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const { order, piId } = await crearPedidoTarjeta(s.h, s.base, { horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '10:30' });
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);

    const res = await dueno().post(`/orders/${order.id}/reembolsar`).expect(201);
    expectExacto(
      res.body,
      ordenEsperada({
        metodoPago: 'TARJETA',
        estadoPago: 'REEMBOLSADO',
        stripePaymentIntentId: 'pi_char_1',
        stripeRefundId: 're_char_1',
        horaRecogidaTipo: 'HORA_ESPECIFICA',
        horaRecogida: '10:30',
        items: [itemEsperado()],
      }),
      etiquetasOrder(s.base, order),
    );
  });
});
