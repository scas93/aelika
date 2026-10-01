import { conectarStripe, seedModificadores, seedPuntoEnvio } from './db';
import { bodyCheckout, eventoPaymentIntent, postCheckout, postWebhook, usarSuite } from './helpers';
import { TIEMPOS_ESPERA_PI } from '../../src/public/public.service';

// Parte B1 · un solo pedido por intento de compra con tarjeta (huella + reutilización).
describe('B2C · reutilización de pedidos TARJETA (Parte B1)', () => {
  const s = usarSuite();

  beforeEach(async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
  });

  const tarjeta = (extra: Record<string, unknown> = {}) =>
    postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { metodoPago: 'TARJETA', ...extra }));
  const pedidos = () => s.h.prisma.order.findMany({ orderBy: { createdAt: 'asc' } });
  const clientes = () => s.h.prisma.cliente.findMany();
  const create = () => s.h.fakes.paymentIntentsCreate;

  /** Hace lenta la creación del PaymentIntent (timers reales en el harness). */
  function retrasarCreacion(ms: number) {
    const original = create().getMockImplementation()!;
    create().mockImplementation(async (...args: unknown[]) => {
      await new Promise((r) => setTimeout(r, ms));
      return original(...args);
    });
  }

  describe('reutiliza', () => {
    it('mismo carrito dos veces: un pedido, mismo folio, mismo PaymentIntent y mismo contrato', async () => {
      const a = await tarjeta();
      const b = await tarjeta();
      expect([a.status, b.status]).toStrictEqual([201, 201]);
      expect(b.body.id).toBe(a.body.id);
      expect(b.body.folio).toBe(a.body.folio);
      expect(b.body.stripePaymentIntentId).toBe(a.body.stripePaymentIntentId);
      expect(b.body.clientSecret).toBe(a.body.clientSecret);
      expect(Object.keys(b.body).sort()).toStrictEqual(Object.keys(a.body).sort());
      expect(b.body).not.toHaveProperty('huellaCheckout');
      expect(b.body).not.toHaveProperty('detalleB2c');
      expect(await pedidos()).toHaveLength(1);
      expect(create()).toHaveBeenCalledTimes(1);
      expect(create().mock.calls[0][1]).toStrictEqual({ idempotencyKey: `pi-${a.body.id}` });
      expect(s.h.fakes.paymentIntentsCancel).not.toHaveBeenCalled();
      expect(s.h.fakes.queueAdd).not.toHaveBeenCalled(); // "pedido recibido" lo dispara el webhook al pagarse
    });

    it('líneas idénticas del carrito equivalen a una línea con la cantidad sumada', async () => {
      const a = await tarjeta({ items: [{ productId: s.base.productoA.id, cantidad: 2 }] });
      const b = await tarjeta({
        items: [
          { productId: s.base.productoA.id, cantidad: 1 },
          { productId: s.base.productoA.id, cantidad: 1 },
        ],
      });
      expect(b.body.id).toBe(a.body.id);
      expect(await pedidos()).toHaveLength(1);
    });

    it('horaRecogida distinta (opción rápida): reutiliza y actualiza la hora en Order y en DetalleB2C', async () => {
      const a = await tarjeta({ horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '10:30' });
      const b = await tarjeta({ horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '10:45' });
      expect(b.status).toBe(201);
      expect(b.body.id).toBe(a.body.id);
      expect(b.body.horaRecogida).toBe('10:45');
      const [o] = await s.h.prisma.order.findMany({ include: { detalleB2c: true } });
      expect(o.horaRecogida).toBe('10:45');
      expect(o.detalleB2c!.horaRecogida).toBe('10:45');
      expect(o.horaRecogidaTipo).toBe('HORA_ESPECIFICA');
      expect(await pedidos()).toHaveLength(1);
    });

    it('la hora enviada sigue validándose en cada request (pasada o sin margen: 400, el pedido no cambia)', async () => {
      const a = await tarjeta({ horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '10:30' });
      const b = await tarjeta({ horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '10:05' });
      expect(b.status).toBe(400);
      const [o] = await pedidos();
      expect(o.id).toBe(a.body.id);
      expect(o.horaRecogida).toBe('10:30');
    });

    it('dentro de la ventana (1 h 59 min) reutiliza y conserva createdAt y folio', async () => {
      const a = await tarjeta();
      jest.setSystemTime(new Date('2026-09-30T17:59:00.000Z'));
      const b = await tarjeta();
      expect(b.body.id).toBe(a.body.id);
      expect(b.body.createdAt).toBe('2026-09-30T16:00:00.000Z');
      expect(b.body.folio).toBe('1');
    });

    it('FALLIDO con PaymentIntent (tarjeta rechazada): se reutiliza y sigue FALLIDO (no cambia su estadoPago)', async () => {
      const a = await tarjeta();
      await postWebhook(s.h, eventoPaymentIntent('payment_intent.payment_failed', a.body.stripePaymentIntentId, 4500)).expect(200);
      const b = await tarjeta();
      expect(b.body.id).toBe(a.body.id);
      expect(b.body.clientSecret).toBe(a.body.clientSecret);
      expect(b.body.estadoPago).toBe('FALLIDO');
      expect(await pedidos()).toHaveLength(1);
    });

    it('PaymentIntent en requires_action (3D Secure a medias) se acepta', async () => {
      const a = await tarjeta();
      s.h.fakes.piStore.get(a.body.stripePaymentIntentId).status = 'requires_action';
      const b = await tarjeta();
      expect(b.body.id).toBe(a.body.id);
    });

    it('pedido PENDIENTE sin PaymentIntent y reciente (otro request en vuelo): espera y da 409, sin crear otro PaymentIntent', async () => {
      const a = await tarjeta();
      await s.h.prisma.order.update({ where: { id: a.body.id }, data: { stripePaymentIntentId: null } });
      const original = { ...TIEMPOS_ESPERA_PI };
      TIEMPOS_ESPERA_PI.intervaloMs = 10;
      TIEMPOS_ESPERA_PI.maxMs = 60;
      try {
        const b = await tarjeta();
        expect(b.status).toBe(409);
        expect(b.body.message).toBe('Reintenta en un momento');
        expect(create()).toHaveBeenCalledTimes(1);
      } finally {
        Object.assign(TIEMPOS_ESPERA_PI, original);
      }
    });

    it('pedido PENDIENTE sin PaymentIntent abandonado (proceso muerto, > 2 min): espera, y luego crea con la misma llave', async () => {
      const a = await tarjeta();
      await s.h.prisma.order.update({ where: { id: a.body.id }, data: { stripePaymentIntentId: null } });
      jest.setSystemTime(new Date('2026-09-30T16:03:00.000Z'));
      const original = { ...TIEMPOS_ESPERA_PI };
      TIEMPOS_ESPERA_PI.intervaloMs = 10;
      TIEMPOS_ESPERA_PI.maxMs = 60;
      try {
        const b = await tarjeta();
        expect(b.status).toBe(201);
        expect(b.body.id).toBe(a.body.id);
        expect(b.body.stripePaymentIntentId).toBe(a.body.stripePaymentIntentId);
        expect(create()).toHaveBeenCalledTimes(2);
        expect(create().mock.calls[1][1]).toStrictEqual({ idempotencyKey: `pi-${a.body.id}` });
        expect(s.h.fakes.piStore.size).toBe(1);
      } finally {
        Object.assign(TIEMPOS_ESPERA_PI, original);
      }
    });

    it('contadores: reutilizar no toca Cliente ni totalPedidos; pagar suma 1 con la fecha de creación', async () => {
      const a = await tarjeta();
      const antes = (await clientes())[0];
      await tarjeta();
      const despues = (await clientes())[0];
      expect(despues).toStrictEqual(antes);
      expect(despues.totalPedidos).toBe(0);
      await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', a.body.stripePaymentIntentId, 4500)).expect(200);
      const pagado = (await clientes())[0];
      expect(pagado.totalPedidos).toBe(1);
      expect(pagado.ultimoPedidoAt.toISOString()).toBe('2026-09-30T16:00:00.000Z');
    });
  });

  describe('pedido nuevo (y cancela el cobro del anterior)', () => {
    async function esperaNuevo(extra: Record<string, unknown>, preparar?: () => Promise<void>) {
      const a = await tarjeta();
      if (preparar) await preparar();
      const b = await tarjeta(extra);
      expect(b.status).toBe(201);
      expect(b.body.id).not.toBe(a.body.id);
      expect(b.body.folio).toBe('2');
      expect(b.body.stripePaymentIntentId).not.toBe(a.body.stripePaymentIntentId);
      expect(await pedidos()).toHaveLength(2);
      return { a, b };
    }

    it('cantidad distinta: pedido y PaymentIntent nuevos; se cancela el cobro del anterior, no su pedido', async () => {
      const { a } = await esperaNuevo({ items: [{ productId: s.base.productoA.id, cantidad: 2 }] });
      expect(s.h.fakes.paymentIntentsCancel).toHaveBeenCalledWith(a.body.stripePaymentIntentId);
      expect(s.h.fakes.piStore.get(a.body.stripePaymentIntentId).status).toBe('canceled');
      const anterior = await s.h.prisma.order.findUniqueOrThrow({ where: { id: a.body.id } });
      expect(anterior.estadoPago).toBe('PENDIENTE');
    });

    it('modificador distinto', async () => {
      const { opciones } = await seedModificadores(s.h.prisma, s.base.tenant.id, s.base.productoA.id, {
        opciones: [
          { nombre: 'Chica', precioAdicional: '0' },
          { nombre: 'Grande', precioAdicional: '30' },
        ],
      });
      const { a } = await esperaNuevo(
        { items: [{ productId: s.base.productoA.id, cantidad: 1, modifierOptionIds: [opciones[0].id] }] },
      );
      expect(s.h.fakes.piStore.get(a.body.stripePaymentIntentId).status).toBe('canceled');
    });

    it('método de entrega distinto', async () => {
      const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
      const { a } = await esperaNuevo({
        metodoEntrega: 'DOMICILIO',
        puntoEnvioId: punto.id,
        direccionCalle: 'Reforma',
        direccionNumero: '100',
        direccionColonia: 'Centro',
      });
      expect(s.h.fakes.piStore.get(a.body.stripePaymentIntentId).status).toBe('canceled');
    });

    it('pedido PAGADO con el mismo carrito: compra nueva', async () => {
      await esperaNuevo({}, async () => {
        const [o] = await pedidos();
        await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', o.stripePaymentIntentId!, 4500)).expect(200);
      });
      expect(s.h.fakes.paymentIntentsCancel).not.toHaveBeenCalled(); // el PAGADO no es huérfano
    });

    it('pedido REEMBOLSADO con el mismo carrito: compra nueva', async () => {
      await esperaNuevo({}, async () => {
        const [o] = await pedidos();
        await s.h.prisma.order.update({ where: { id: o.id }, data: { estadoPago: 'REEMBOLSADO' } });
      });
    });

    it('PaymentIntent cancelado', async () => {
      await esperaNuevo({}, async () => {
        const [o] = await pedidos();
        s.h.fakes.piStore.get(o.stripePaymentIntentId!).status = 'canceled';
      });
    });

    it('PaymentIntent con monto distinto', async () => {
      const { a } = await esperaNuevo({}, async () => {
        const [o] = await pedidos();
        s.h.fakes.piStore.get(o.stripePaymentIntentId!).amount = 100;
      });
      expect(s.h.fakes.piStore.get(a.body.stripePaymentIntentId).status).toBe('canceled');
    });

    it('PaymentIntent con destino distinto (el negocio cambió de cuenta)', async () => {
      await esperaNuevo({}, async () => {
        const [o] = await pedidos();
        s.h.fakes.piStore.get(o.stripePaymentIntentId!).transfer_data = { destination: 'acct_otra' };
      });
    });

    it('PaymentIntent que Stripe ya no conoce (resource_missing)', async () => {
      await esperaNuevo({}, async () => {
        const [o] = await pedidos();
        s.h.fakes.piStore.delete(o.stripePaymentIntentId!);
      });
    });

    it('fuera de la ventana de 2 horas', async () => {
      await esperaNuevo({}, async () => {
        jest.setSystemTime(new Date('2026-09-30T18:01:00.000Z'));
      });
    });

    it('pedido anterior a la Parte B1 (huella nula): nunca se reutiliza', async () => {
      await esperaNuevo({}, async () => {
        await s.h.prisma.order.updateMany({ data: { huellaCheckout: null } });
      });
    });
  });

  describe('otro cliente / otros datos', () => {
    it('mismo teléfono con otro nombre: pedido nuevo, sin datos ajenos y SIN cancelar el cobro del otro', async () => {
      const a = await tarjeta();
      const b = await tarjeta({ clienteNombre: 'Intruso Pérez' });
      expect(b.body.id).not.toBe(a.body.id);
      expect(b.body.clienteNombre).toBe('Intruso Pérez');
      expect(b.body.stripePaymentIntentId).not.toBe(a.body.stripePaymentIntentId);
      expect(s.h.fakes.paymentIntentsCancel).not.toHaveBeenCalled();
      expect(s.h.fakes.piStore.get(a.body.stripePaymentIntentId).status).toBe('requires_payment_method');
    });

    it('mismo teléfono y mismo nombre normalizado (acentos/mayúsculas/espacios) pero otro dato: cancela el cobro anterior', async () => {
      const a = await tarjeta({ clienteNombre: 'Ána  Prueba' });
      const b = await tarjeta({ clienteNombre: 'ana prueba', notas: 'sin cebolla' });
      expect(b.body.id).not.toBe(a.body.id);
      expect(s.h.fakes.paymentIntentsCancel).toHaveBeenCalledWith(a.body.stripePaymentIntentId);
    });

    it('mismo carrito con otra dirección: pedido nuevo', async () => {
      const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
      const dom = { metodoEntrega: 'DOMICILIO', puntoEnvioId: punto.id, direccionNumero: '100', direccionColonia: 'Centro' };
      const a = await tarjeta({ ...dom, direccionCalle: 'Reforma' });
      const b = await tarjeta({ ...dom, direccionCalle: 'Juárez' });
      expect(b.body.id).not.toBe(a.body.id);
      expect(b.body.direccionCalle).toBe('Juárez');
    });

    it('otro teléfono con el mismo carrito: pedido nuevo', async () => {
      const a = await tarjeta();
      const b = await tarjeta({ clienteTelefono: '5599998888' });
      expect(b.body.id).not.toBe(a.body.id);
      expect(s.h.fakes.paymentIntentsCancel).not.toHaveBeenCalled();
    });
  });

  describe('pago en proceso', () => {
    it('pedido PROCESANDO: 409 y ningún cobro nuevo', async () => {
      const a = await tarjeta();
      await postWebhook(s.h, eventoPaymentIntent('payment_intent.processing', a.body.stripePaymentIntentId, 4500)).expect(200);
      const b = await tarjeta();
      expect(b.status).toBe(409);
      expect(b.body.message).toBe('Tu pago anterior sigue procesándose');
      expect(await pedidos()).toHaveLength(1);
      expect(create()).toHaveBeenCalledTimes(1);
    });

    it.each(['processing', 'succeeded'])('PaymentIntent %s con el pedido aún PENDIENTE (webhook sin llegar): 409', async (estado) => {
      const a = await tarjeta();
      s.h.fakes.piStore.get(a.body.stripePaymentIntentId).status = estado;
      const b = await tarjeta();
      expect(b.status).toBe(409);
      expect(b.body.message).toBe('Tu pago anterior sigue procesándose');
      expect(await pedidos()).toHaveLength(1);
      expect(create()).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrencia', () => {
    it('dos requests simultáneos con el mismo carrito: un solo pedido y un solo PaymentIntent', async () => {
      retrasarCreacion(150);
      const [a, b] = await Promise.all([tarjeta(), tarjeta()]);
      expect([a.status, b.status]).toStrictEqual([201, 201]);
      expect(b.body.id).toBe(a.body.id);
      expect(b.body.stripePaymentIntentId).toBe(a.body.stripePaymentIntentId);
      expect(b.body.clientSecret).toBe(a.body.clientSecret);
      expect(await pedidos()).toHaveLength(1);
      expect(s.h.fakes.piStore.size).toBe(1);
    });

    it('dos requests simultáneos sobre un candidato rechazado: un solo pedido de reemplazo', async () => {
      const a = await tarjeta();
      s.h.fakes.piStore.get(a.body.stripePaymentIntentId).status = 'canceled';
      const [b, c] = await Promise.all([tarjeta(), tarjeta()]);
      expect([b.status, c.status]).toStrictEqual([201, 201]);
      expect(b.body.id).toBe(c.body.id);
      expect(b.body.id).not.toBe(a.body.id);
      expect(await pedidos()).toHaveLength(2);
      expect(s.h.fakes.piStore.size).toBe(2);
    });

    it('dos reintentos simultáneos de un FALLIDO sin PaymentIntent: gana uno, el otro lo recoge; un solo PaymentIntent nuevo', async () => {
      create().mockRejectedValueOnce(new Error('stripe caído'));
      const fallo = await tarjeta();
      expect(fallo.status).toBe(503);
      retrasarCreacion(300);
      const [b, c] = await Promise.all([tarjeta(), tarjeta()]);
      expect([b.status, c.status]).toStrictEqual([201, 201]);
      expect(b.body.stripePaymentIntentId).toBe(c.body.stripePaymentIntentId);
      expect(await pedidos()).toHaveLength(1);
      expect(s.h.fakes.piStore.size).toBe(1);
    });

    it('el perdedor del reclamo que no ve el PaymentIntent a tiempo recibe 409 "Reintenta en un momento"', async () => {
      create().mockRejectedValueOnce(new Error('stripe caído'));
      await tarjeta();
      const original = { ...TIEMPOS_ESPERA_PI };
      TIEMPOS_ESPERA_PI.intervaloMs = 20;
      TIEMPOS_ESPERA_PI.maxMs = 150;
      try {
        retrasarCreacion(800);
        const [b, c] = await Promise.all([tarjeta(), tarjeta()]);
        const respuestas = [b, c].sort((x, y) => x.status - y.status);
        expect(respuestas.map((r) => r.status)).toStrictEqual([201, 409]);
        expect(respuestas[1].body.message).toBe('Reintenta en un momento');
        expect(await pedidos()).toHaveLength(1);
      } finally {
        Object.assign(TIEMPOS_ESPERA_PI, original);
      }
    });
  });

  describe('fallo de Stripe al crear el PaymentIntent', () => {
    it('503, pedido FALLIDO sin PaymentIntent; el reintento reutiliza el mismo folio con llave nueva', async () => {
      create().mockRejectedValueOnce(new Error('stripe caído'));
      const a = await tarjeta();
      expect(a.status).toBe(503);
      expect(a.body.message).toBe('No pudimos iniciar el pago con tarjeta, intenta de nuevo');
      const [fallido] = await pedidos();
      expect(fallido.estadoPago).toBe('FALLIDO');
      expect(fallido.stripePaymentIntentId).toBeNull();
      expect(fallido.folio).toBe('1');

      const b = await tarjeta();
      expect(b.status).toBe(201);
      expect(b.body.id).toBe(fallido.id);
      expect(b.body.folio).toBe('1');
      expect(b.body.estadoPago).toBe('PENDIENTE');
      expect(b.body.clientSecret).toEqual(expect.any(String));
      expect(await pedidos()).toHaveLength(1);
      const llaves = create().mock.calls.map((c) => c[1].idempotencyKey);
      expect(llaves[0]).toBe(`pi-${fallido.id}`);
      expect(llaves[1]).toMatch(new RegExp(`^pi-${fallido.id}-[0-9a-f-]{36}$`));
    });

    it('si el reintento vuelve a fallar: 503 y el pedido vuelve a FALLIDO', async () => {
      create().mockRejectedValueOnce(new Error('caído 1')).mockRejectedValueOnce(new Error('caído 2'));
      expect((await tarjeta()).status).toBe(503);
      expect((await tarjeta()).status).toBe(503);
      const [o] = await pedidos();
      expect(o.estadoPago).toBe('FALLIDO');
      expect(o.stripePaymentIntentId).toBeNull();
      expect(await pedidos()).toHaveLength(1);
    });
  });

  describe('EFECTIVO y TRANSFERENCIA no cambian', () => {
    it('EFECTIVO: dos envíos idénticos siguen siendo dos pedidos PAGADO, sin huella ni PaymentIntent', async () => {
      const a = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      const b = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      expect(b.body.id).not.toBe(a.body.id);
      const todos = await pedidos();
      expect(todos.map((o) => o.estadoPago)).toStrictEqual(['PAGADO', 'PAGADO']);
      expect(todos.map((o) => o.huellaCheckout)).toStrictEqual([null, null]);
      expect(create()).not.toHaveBeenCalled();
    });

    it('TRANSFERENCIA: 409 como antes', async () => {
      const r = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { metodoPago: 'TRANSFERENCIA' }));
      expect(r.status).toBe(409);
      expect(r.body.message).toBe('Ese método de pago no está disponible todavía');
    });
  });
});
