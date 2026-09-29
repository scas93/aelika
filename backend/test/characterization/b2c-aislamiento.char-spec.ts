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

  it('B no puede leer un pedido de A por id (404, igual que un id inexistente)', async () => {
    const res = await apiB().get(`/orders/${ids.efectivoA}`).expect(404);
    expect(res.body).toEqual({ message: 'Pedido no encontrado', error: 'Not Found', statusCode: 404 });
    await apiA().get(`/orders/${ids.efectivoA}`).expect(200);
  });

  it('las listas de B solo traen lo de B: /orders, histórico, CSV, resúmenes', async () => {
    const lista = await apiB().get('/orders').expect(200);
    expect(lista.body.map((o: any) => o.clienteNombre)).toEqual(['Cliente de B']);

    const hist = await apiB().get('/orders/historico').expect(200);
    expect(hist.body.total).toBe(1);
    expect(hist.body.data[0].clienteNombre).toBe('Cliente de B');

    const csv = await apiB().get('/orders/historico/export').expect(200);
    expect(csv.text).toContain('Cliente de B');
    expect(csv.text).not.toContain('Cliente de A');

    const resumen = await apiB().get(`/orders/summary?${RANGO}`).expect(200);
    expect(resumen.body).toMatchObject({ pedidosHoy: 1, ingresosHoy: '45.00' });
    const resumenA = await apiA().get(`/orders/summary?${RANGO}`).expect(200);
    expect(resumenA.body).toMatchObject({ pedidosHoy: 2, ingresosHoy: '90.00' });

    const daily = await apiB().get(`/orders/summary/daily?${RANGO}`).expect(200);
    expect(daily.body.at(-1)).toEqual({ fecha: '2026-09-30', pedidos: 1 });
    const estatus = await apiB().get(`/orders/summary/estatus?${RANGO}`).expect(200);
    expect(estatus.body[0]).toEqual({ estadoPedido: 'PENDIENTE_CONFIRMACION', conteo: 1 });
  });

  it('B no puede avanzar ni reembolsar pedidos de A (404) y no toca Stripe; A queda intacto', async () => {
    await apiB().patch(`/orders/${ids.efectivoA}/avanzar`).expect(404);
    await apiB().post(`/orders/${ids.tarjetaA}/reembolsar`).expect(404);
    expect(s.h.fakes.refundsCreate).not.toHaveBeenCalled();
    await cederEventLoop();
    expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
    expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();

    const a1 = await s.h.prisma.order.findUniqueOrThrow({ where: { id: ids.efectivoA } });
    const a2 = await s.h.prisma.order.findUniqueOrThrow({ where: { id: ids.tarjetaA } });
    expect(a1.estadoPedido).toBe('PENDIENTE_CONFIRMACION');
    expect(a2).toMatchObject({ estadoPago: 'PAGADO', stripeRefundId: null });
  });

  it('/payments y /clientes de B no incluyen nada de A', async () => {
    const pagosB = await apiB().get('/payments').expect(200);
    expect(pagosB.body.total).toBe(0);
    const pagosA = await apiA().get('/payments').expect(200);
    expect(pagosA.body.total).toBe(1);

    const clientesB = await apiB().get('/clientes').expect(200);
    expect(clientesB.body.data.map((c: any) => c.nombre)).toEqual(['Cliente de B']);
    const activosB = await apiB().get('/clientes/activos').expect(200);
    expect(activosB.body).toEqual({ clientesActivos: 1 });
    const dailyB = await apiB().get(`/clientes/summary/daily?${RANGO}`).expect(200);
    expect(dailyB.body.at(-1)).toEqual({ fecha: '2026-09-30', nuevos: 1, recurrentes: 0 });
    const buscarA = await apiB().get('/clientes?q=Cliente%20de%20A').expect(200);
    expect(buscarA.body.total).toBe(0);
  });

  it('puntos de envío: B no los ve, no los edita ni los borra (404)', async () => {
    const lista = await apiB().get('/puntos-envio').expect(200);
    expect(lista.body).toEqual([]);
    await apiB().delete(`/puntos-envio/${ids.puntoA}`).expect(404);
    expect(await s.h.prisma.puntoEnvio.count()).toBe(1);
  });

  it('estado-pago público: el id de A con el slug de B da 404', async () => {
    await request(s.h.app.getHttpServer()).get(`/public/tenants/${b.tenant.slug}/orders/${ids.tarjetaA}/estado-pago`).expect(404);
    await request(s.h.app.getHttpServer()).get(`/public/tenants/${s.base.tenant.slug}/orders/${ids.tarjetaA}/estado-pago`).expect(200);
  });

  it('checkout en B con recursos de A: producto, punto de envío y opción de modificador ajenos dan 404', async () => {
    const prod = await postCheckout(s.h, b.tenant.slug, bodyCheckout(b, { items: [{ productId: s.base.productoA.id, cantidad: 1 }] }));
    expect(prod.status).toBe(404);
    const punto = await postCheckout(
      s.h,
      b.tenant.slug,
      bodyCheckout(b, {
        metodoEntrega: 'DOMICILIO',
        puntoEnvioId: ids.puntoA,
        direccionCalle: 'C',
        direccionNumero: '1',
        direccionColonia: 'Col',
      }),
    );
    expect(punto.status).toBe(404);
    expect(punto.body.message).toBe('Punto de envío no encontrado');
    expect(await s.h.prisma.order.count({ where: { tenantId: b.tenant.id } })).toBe(1); // solo el del beforeEach
  });

  it('el catálogo público de B no incluye productos de A', async () => {
    const res = await request(s.h.app.getHttpServer()).get(`/public/tenants/${b.tenant.slug}/catalog`).expect(200);
    const idsProductos = res.body.categories.flatMap((c: any) => c.products.map((p: any) => p.id));
    expect(idsProductos).toEqual(expect.arrayContaining([b.productoA.id, b.productoB.id]));
    expect(idsProductos).not.toContain(s.base.productoA.id);
  });

  it('un JWT sin sesión válida no ve nada (401)', async () => {
    await request(s.h.app.getHttpServer()).get('/orders').set('Authorization', 'Bearer token.invalido.x').expect(401);
  });
});
