import { tokenFor } from './auth';
import { conectarStripe, seedModificadores, seedPromocion, seedPuntoEnvio } from './db';
import {
  auth,
  bodyCheckout,
  crearPedidoTarjeta,
  eventoPaymentIntent,
  postCheckout,
  postWebhook,
  usarSuite,
} from './helpers';
import { waitForCalls } from './harness';
import { normalizar } from './normalizar';

// Área 9 · Salidas exactas: recibo de Telegram (PEDIDO_RECIBIDO), HTML del correo (PEDIDO_*) y contexto de reglas ORDER.
describe('B2C · salidas', () => {
  const s = usarSuite();
  const dueno = () => auth(s.h, tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO'));

  const recibo = () => {
    const job = s.h.fakes.queueAdd.mock.calls.map(([, d]) => d).find((d) => d.evento === 'PEDIDO_RECIBIDO');
    return job!.mensaje;
  };

  describe('recibo de Telegram ("Pedido recibido")', () => {
    it('EFECTIVO, lo antes posible: sin línea "Llega en", indicador de cobro pendiente', async () => {
      await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      await waitForCalls(s.h.fakes.queueAdd);
      expect(recibo().asunto).toBe('Nuevo pedido #1');
      expect(recibo().texto).toMatchSnapshot();
    });

    it('hora específica + varias líneas (con la categoría junto al nombre)', async () => {
      await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, {
          horaRecogidaTipo: 'HORA_ESPECIFICA',
          horaRecogida: '10:45',
          notas: 'Sin hielo por favor',
          items: [
            { productId: s.base.productoA.id, cantidad: 2 },
            { productId: s.base.productoB.id, cantidad: 3 },
          ],
        }),
      );
      await waitForCalls(s.h.fakes.queueAdd);
      // Congelado tal cual: el recibo no incluye las notas del cliente.
      expect(recibo().texto).toMatchSnapshot();
    });

    it('modificadores por línea + descuento de combo', async () => {
      await seedPromocion(s.h.prisma, s.base.tenant.id, 'COMBO', {
        productIds: [s.base.productoA.id, s.base.productoB.id],
        precioCombo: 60,
      });
      const tam = await seedModificadores(s.h.prisma, s.base.tenant.id, s.base.productoA.id, {
        nombre: 'Tamaño',
        obligatorio: true,
        orden: 0,
        opciones: [{ nombre: 'Grande', precioAdicional: '30.00' }],
      });
      const extras = await seedModificadores(s.h.prisma, s.base.tenant.id, s.base.productoA.id, {
        nombre: 'Extras',
        tipoSeleccion: 'MULTIPLE',
        orden: 1,
        opciones: [{ nombre: 'Shot extra', precioAdicional: '10.00' }],
      });
      await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, {
          items: [
            { productId: s.base.productoA.id, cantidad: 1, modifierOptionIds: [extras.opciones[0].id, tam.opciones[0].id] },
            { productId: s.base.productoB.id, cantidad: 1 },
          ],
        }),
      );
      await waitForCalls(s.h.fakes.queueAdd);
      expect(recibo().texto).toMatchSnapshot();
    });

    it('DOMICILIO: el recibo no menciona entrega ni dirección (congelado tal cual)', async () => {
      const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
      await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, {
          metodoEntrega: 'DOMICILIO',
          puntoEnvioId: punto.id,
          direccionCalle: 'Calle Roble',
          direccionNumero: '12',
          direccionColonia: 'Del Valle',
        }),
      );
      await waitForCalls(s.h.fakes.queueAdd);
      const { texto } = recibo();
      expect(texto).not.toMatch(/Roble|Del Valle|domicilio|Zona Centro/i);
      expect(texto).toMatchSnapshot();
    });

    it('TARJETA: solo se envía al confirmarse el pago, con el indicador "PAGADO CON TARJETA"', async () => {
      await conectarStripe(s.h.prisma, s.base.tenant.id);
      const { piId } = await crearPedidoTarjeta(s.h, s.base);
      await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
      await waitForCalls(s.h.fakes.queueAdd, 2);
      expect(recibo().texto).toMatchSnapshot();
    });
  });

  describe('HTML del correo (avanzar: PEDIDO_CONFIRMADO / PEDIDO_EN_CAMINO / PEDIDO_ENTREGADO)', () => {
    it('con modificadores, descuento y correo del cliente: HTML exacto de las 3 transiciones', async () => {
      await seedPromocion(s.h.prisma, s.base.tenant.id, 'DESCUENTO_PRODUCTO', {
        productId: s.base.productoB.id,
        tipoDescuento: 'porcentaje',
        valor: 10,
      });
      const tam = await seedModificadores(s.h.prisma, s.base.tenant.id, s.base.productoA.id, {
        nombre: 'Tamaño',
        opciones: [{ nombre: 'Grande', precioAdicional: '30.00' }],
      });
      const res = await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, {
          clienteCorreo: 'ana@test.com',
          items: [
            { productId: s.base.productoA.id, cantidad: 2, modifierOptionIds: [tam.opciones[0].id] },
            { productId: s.base.productoB.id, cantidad: 2 },
          ],
        }),
      );
      await waitForCalls(s.h.fakes.queueAdd);
      s.h.fakes.reset();

      for (let i = 0; i < 3; i++) await dueno().patch(`/orders/${res.body.id}/avanzar`).expect(200);
      await waitForCalls(s.h.fakes.queueAdd, 3);
      const htmls = s.h.fakes.queueAdd.mock.calls.map(([, d]) => ({ evento: d.evento, html: d.mensaje.html }));
      expect(htmls).toMatchSnapshot();
    });

    it('un producto sin modificadores muestra "Sin modificadores" y sin descuento no hay fila de descuento', async () => {
      const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      await waitForCalls(s.h.fakes.queueAdd);
      s.h.fakes.reset();
      await dueno().patch(`/orders/${res.body.id}/avanzar`).expect(200);
      await waitForCalls(s.h.fakes.queueAdd);
      const html: string = s.h.fakes.queueAdd.mock.calls[0][1].mensaje.html;
      expect(html).toContain('Sin modificadores');
      expect(html).not.toContain('Descuento:');
    });
  });

  describe('contexto de reglas ORDER (dispararSeguro)', () => {
    it('RECOGER: objeto exacto, con las variables de menudeo (entrega, dirección null, método de pago)', async () => {
      const res = await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, {
          items: [
            { productId: s.base.productoA.id, cantidad: 2 },
            { productId: s.base.productoB.id, cantidad: 1 },
          ],
        }),
      );
      await waitForCalls(s.h.fakes.queueAdd);
      await dueno().patch(`/orders/${res.body.id}/avanzar`).expect(200);

      expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(1);
      expect(
        normalizar(s.h.fakes.dispararSeguro.mock.calls[0][0], {
          [s.base.tenant.id]: 'tenant',
          [res.body.clienteId]: 'cliente',
        }),
      ).toEqual({
        tenantId: '<tenant>',
        origen: 'ORDER',
        estatus: 'CONFIRMADO_SURTIENDO',
        clienteId: '<cliente>',
        contexto: {
          origen: 'ORDER',
          folio: '1',
          total: '120.5',
          estatus: 'CONFIRMADO_SURTIENDO',
          createdAt: '<iso>',
          items: [
            { nombreProducto: 'Café americano', cantidad: 2 },
            { nombreProducto: 'Concha', cantidad: 1 },
          ],
          metodoEntrega: 'RECOGER',
          direccionCalle: null,
          direccionNumero: null,
          direccionColonia: null,
          metodoPago: 'EFECTIVO',
        },
      });
    });

    it('DOMICILIO + TARJETA: dirección y método de pago reales en el contexto', async () => {
      await conectarStripe(s.h.prisma, s.base.tenant.id);
      const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
      const { order, piId } = await crearPedidoTarjeta(s.h, s.base, {
        metodoEntrega: 'DOMICILIO',
        puntoEnvioId: punto.id,
        direccionCalle: 'Calle Roble',
        direccionNumero: '12',
        direccionColonia: 'Del Valle',
      });
      await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
      await waitForCalls(s.h.fakes.queueAdd, 2);
      s.h.fakes.reset();

      await dueno().patch(`/orders/${order.id}/avanzar`).expect(200);
      await dueno().patch(`/orders/${order.id}/avanzar`).expect(200);
      expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(2);
      const [, segunda] = s.h.fakes.dispararSeguro.mock.calls.map(([p]) =>
        normalizar(p, { [s.base.tenant.id]: 'tenant', [order.clienteId]: 'cliente' }),
      );
      expect(segunda).toEqual({
        tenantId: '<tenant>',
        origen: 'ORDER',
        estatus: 'LISTO_ENTREGA',
        clienteId: '<cliente>',
        contexto: {
          origen: 'ORDER',
          folio: '1',
          total: '45',
          estatus: 'LISTO_ENTREGA',
          createdAt: '<iso>',
          items: [{ nombreProducto: 'Café americano', cantidad: 1 }],
          metodoEntrega: 'DOMICILIO',
          direccionCalle: 'Calle Roble',
          direccionNumero: '12',
          direccionColonia: 'Del Valle',
          metodoPago: 'TARJETA',
        },
      });
    });
  });
});
