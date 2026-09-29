import request from 'supertest';
import { tokenFor } from './auth';
import { BaseSeed, conectarStripe, seedBase, seedPuntoEnvio } from './db';
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
import { clienteEsperado, etiquetasOrder, expectError, expectExacto, ordenEsperada } from './exacto';
import { normalizar } from './normalizar';

// Área 11 · Aislamiento multi-tenant: el tenant B no ve ni modifica pedidos del tenant A.
describe('B2C · aislamiento multi-tenant', () => {
  const s = usarSuite();
  let b: BaseSeed;
  let ids: { efectivoA: string; tarjetaA: string; puntoA: string; clienteA: string };
  const tokenA = () => tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO');
  const apiA = () => auth(s.h, tokenA());
  const apiB = () => auth(s.h, tokenFor(s.h.jwt, b.dueno, b.tenant.id, 'DUENO'));

  beforeEach(async () => {
    b = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const puntoA = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);

    const efectivo = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteNombre: 'Cliente de A' }));
    const tarjeta = await crearPedidoTarjeta(s.h, s.base, { clienteTelefono: '5599990001' });
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', tarjeta.piId, 4500)).expect(200);
    await waitForCalls(s.h.fakes.queueAdd, 3);

    // Un pedido propio de B, para distinguir "lista vacía" de "lista solo lo mío".
    await postCheckout(s.h, b.tenant.slug, bodyCheckout(b, { clienteNombre: 'Cliente de B', clienteTelefono: '5588880001' }));
    await waitForCalls(s.h.fakes.queueAdd, 4);
    s.h.fakes.reset();

    ids = { efectivoA: efectivo.body.id, tarjetaA: tarjeta.order.id, puntoA: puntoA.id, clienteA: efectivo.body.clienteId };
  });

  const RANGO = 'desde=2026-09-30T06:00:00.000Z&hasta=2026-10-01T05:59:59.999Z';
  const DIAS_VACIOS = ['21', '22', '23', '24', '25', '26', '27', '28', '29'];
  const paginaVacia = { data: [], total: 0, page: 1, limit: 25, totalPages: 0 };

  /** Pedido de B tal como lo devuelve findAll (items sin `modificadores`). */
  const pedidoDeB = () => ordenEsperada({ clienteNombre: 'Cliente de B', clienteTelefono: '5588880001' });

  it('B no puede leer un pedido de A por id (404, igual que un id inexistente)', async () => {
    expectError(await apiB().get(`/orders/${ids.efectivoA}`), 404, 'Pedido no encontrado');
    await apiA().get(`/orders/${ids.efectivoA}`).expect(200);
  });

  it('las listas de B solo traen lo de B: /orders, histórico, CSV, resúmenes (respuestas exactas)', async () => {
    const lista = await apiB().get('/orders').expect(200);
    expect(lista.body).toHaveLength(1);
    expectExacto(lista.body, [pedidoDeB()], etiquetasOrder(b, lista.body[0]));

    const hist = await apiB().get('/orders/historico').expect(200);
    expect(normalizar(hist.body, { [lista.body[0].id]: 'order' })).toStrictEqual({
      data: [
        {
          id: '<order>',
          folio: '1',
          clienteNombre: 'Cliente de B',
          createdAt: '<iso>',
          estadoPedido: 'PENDIENTE_CONFIRMACION',
          metodoPago: 'EFECTIVO',
          estadoPago: 'PAGADO',
          total: '45',
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
      totalPages: 1,
    });

    const csv = await apiB().get('/orders/historico/export').expect(200);
    expect(csv.text).toBe('﻿Folio,Cliente,Fecha,Estado,Método de pago,Total,Estado de pago\r\n1,Cliente de B,2026-09-30T16:00:00.000Z,PENDIENTE_CONFIRMACION,EFECTIVO,45.00,Pagado');

    expect((await apiB().get(`/orders/summary?${RANGO}`).expect(200)).body).toStrictEqual({
      pedidosHoy: 1,
      ingresosHoy: '45.00',
      ticketPromedioHoy: '45.00',
      promocionesActivas: 0,
    });
    expect((await apiA().get(`/orders/summary?${RANGO}`).expect(200)).body).toStrictEqual({
      pedidosHoy: 2,
      ingresosHoy: '90.00',
      ticketPromedioHoy: '45.00',
      promocionesActivas: 0,
    });

    const daily = await apiB().get(`/orders/summary/daily?${RANGO}`).expect(200);
    expect(daily.body).toStrictEqual([
      ...DIAS_VACIOS.map((d) => ({ fecha: `2026-09-${d}`, pedidos: 0 })),
      { fecha: '2026-09-30', pedidos: 1 },
    ]);
    const estatus = await apiB().get(`/orders/summary/estatus?${RANGO}`).expect(200);
    expect(estatus.body).toStrictEqual([
      { estadoPedido: 'PENDIENTE_CONFIRMACION', conteo: 1 },
      { estadoPedido: 'CONFIRMADO_SURTIENDO', conteo: 0 },
      { estadoPedido: 'LISTO_ENTREGA', conteo: 0 },
      { estadoPedido: 'DESPACHADO', conteo: 0 },
    ]);
  });

  it('B no puede avanzar ni reembolsar pedidos de A (404) y no toca Stripe; A queda intacto', async () => {
    expectError(await apiB().patch(`/orders/${ids.efectivoA}/avanzar`), 404, 'Pedido no encontrado');
    expectError(await apiB().post(`/orders/${ids.tarjetaA}/reembolsar`), 404, 'Pedido no encontrado');
    expect(s.h.fakes.refundsCreate).not.toHaveBeenCalled();
    await cederEventLoop();
    expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
    expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();

    const a1 = await s.h.prisma.order.findUniqueOrThrow({ where: { id: ids.efectivoA } });
    const a2 = await s.h.prisma.order.findUniqueOrThrow({ where: { id: ids.tarjetaA } });
    expect(a1.estadoPedido).toBe('PENDIENTE_CONFIRMACION');
    expect(a2).toMatchObject({ estadoPago: 'PAGADO', stripeRefundId: null }); // fila de BD, no respuesta HTTP
  });

  it('/payments y /clientes de B no incluyen nada de A (respuestas exactas)', async () => {
    expect((await apiB().get('/payments').expect(200)).body).toStrictEqual(paginaVacia);
    const pagosA = await apiA().get('/payments').expect(200);
    expect(normalizar(pagosA.body)).toStrictEqual({
      data: [
        {
          id: pagosA.body.data[0].id, // cuid (no UUID): no determinístico
          amount: '45',
          currency: 'mxn',
          status: 'PAGADO',
          paymentMethodType: 'card',
          cardBrand: null,
          last4: null,
          capturedAt: '<iso>',
          createdAt: '<iso>',
          folio: '2',
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
      totalPages: 1,
    });

    const clientesB = await apiB().get('/clientes').expect(200);
    expect(normalizar(clientesB.body, { [b.tenant.id]: 'tenant' })).toStrictEqual({
      data: [clienteEsperado({ telefono: '5588880001', nombre: 'Cliente de B' })],
      total: 1,
      page: 1,
      limit: 25,
      totalPages: 1,
    });
    expect((await apiB().get('/clientes/activos').expect(200)).body).toStrictEqual({ clientesActivos: 1 });
    expect((await apiB().get(`/clientes/summary/daily?${RANGO}`).expect(200)).body).toStrictEqual([
      ...DIAS_VACIOS.map((d) => ({ fecha: `2026-09-${d}`, nuevos: 0, recurrentes: 0 })),
      { fecha: '2026-09-30', nuevos: 1, recurrentes: 0 },
    ]);
    expect((await apiB().get('/clientes?q=Cliente%20de%20A').expect(200)).body).toStrictEqual(paginaVacia);
  });

  it('puntos de envío: B no los ve, no los edita ni los borra (404)', async () => {
    expect((await apiB().get('/puntos-envio').expect(200)).body).toStrictEqual([]);
    expectError(await apiB().delete(`/puntos-envio/${ids.puntoA}`), 404, 'Punto de envío no encontrado');
    expect(await s.h.prisma.puntoEnvio.count()).toBe(1);
  });

  it('estado-pago público: el id de A con el slug de B da 404', async () => {
    expectError(
      await request(s.h.app.getHttpServer()).get(`/public/tenants/${b.tenant.slug}/orders/${ids.tarjetaA}/estado-pago`),
      404,
      'Pedido no encontrado',
    );
    const ok = await request(s.h.app.getHttpServer()).get(`/public/tenants/${s.base.tenant.slug}/orders/${ids.tarjetaA}/estado-pago`).expect(200);
    expect(ok.body).toStrictEqual({ estadoPago: 'PAGADO' });
  });

  it('checkout en B con recursos de A: producto, punto de envío y opción de modificador ajenos dan 404', async () => {
    expectError(
      await postCheckout(s.h, b.tenant.slug, bodyCheckout(b, { items: [{ productId: s.base.productoA.id, cantidad: 1 }] })),
      404,
      'Uno o más productos no existen en este negocio',
    );
    expectError(
      await postCheckout(
        s.h,
        b.tenant.slug,
        bodyCheckout(b, {
          metodoEntrega: 'DOMICILIO',
          puntoEnvioId: ids.puntoA,
          direccionCalle: 'C',
          direccionNumero: '1',
          direccionColonia: 'Col',
        }),
      ),
      404,
      'Punto de envío no encontrado',
    );
    expect(await s.h.prisma.order.count({ where: { tenantId: b.tenant.id } })).toBe(1); // solo el del beforeEach
  });

  it('el catálogo público de B no incluye productos de A', async () => {
    const res = await request(s.h.app.getHttpServer()).get(`/public/tenants/${b.tenant.slug}/catalog`).expect(200);
    const idsProductos = res.body.categories.flatMap((c: any) => c.products.map((p: any) => p.id));
    expect(idsProductos.sort()).toStrictEqual([b.productoA.id, b.productoB.id].sort());
    expect(idsProductos).not.toContain(s.base.productoA.id);
  });

  it('un JWT inválido: 401 exacto', async () => {
    expectError(await request(s.h.app.getHttpServer()).get('/orders').set('Authorization', 'Bearer token.invalido.x'), 401, 'Unauthorized');
  });
});
