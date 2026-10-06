import { tokenFor } from './auth';
import { conectarStripe, seedPromocion, seedPuntoEnvio } from './db';
import { auth, bodyCheckout, cederEventLoop, crearPedidoTarjeta, postCheckout, usarSuite } from './helpers';
import { waitForCalls } from './harness';

// Etapa 1 · forma de almacenamiento: DetalleB2C 1:1, `tipo`, cascada y unicidad. Etapa 1b-a: la escritura doble se retiró —
// los campos B2C solo se escriben en el detalle y las columnas viejas de Order quedan en su default/null.
describe('B2C · DetalleB2C (almacenamiento, Etapa 1)', () => {
  const s = usarSuite();
  const CAMPOS = [
    'horaRecogidaTipo',
    'horaRecogida',
    'metodoEntrega',
    'puntoEnvioId',
    'direccionCalle',
    'direccionNumero',
    'direccionColonia',
    'direccionReferencias',
    'notasDescuento',
  ] as const;

  it('un checkout DOMICILIO crea la orden con tipo B2C y UN detalle con los 9 campos; las columnas viejas de Order NO se escriben (1b-a)', async () => {
    await seedPromocion(s.h.prisma, s.base.tenant.id, 'DESCUENTO_PRODUCTO', { productId: s.base.productoA.id, tipoDescuento: 'porcentaje', valor: 10 });
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
    const res = await postCheckout(
      s.h,
      s.base.tenant.slug,
      bodyCheckout(s.base, {
        metodoEntrega: 'DOMICILIO',
        puntoEnvioId: punto.id,
        direccionCalle: 'Calle Roble',
        direccionNumero: '12-B',
        direccionColonia: 'Del Valle',
        direccionReferencias: 'Portón azul',
        items: [{ productId: s.base.productoA.id, cantidad: 2 }],
      }),
    );
    expect(res.status).toBe(201);
    await waitForCalls(s.h.fakes.queueAdd);

    const orden = await s.h.prisma.order.findUniqueOrThrow({ where: { id: res.body.id }, include: { detalleB2c: true } });
    expect(orden.tipo).toBe('B2C');
    expect(await s.h.prisma.detalleB2C.count()).toBe(1);
    const d = orden.detalleB2c!;
    expect(d.tenantId).toBe(s.base.tenant.id);
    expect(d.orderId).toBe(orden.id);
    // Etapa 1b-a (cambia a propósito: antes afirmaba que los 9 campos coincidían con las columnas viejas): las columnas
    // viejas ya no se escriben. DATO FALSO DECLARADO: metodoEntrega queda en su default RECOGER aunque esta orden sea
    // DOMICILIO (y horaRecogidaTipo en LO_ANTES_POSIBLE). Es inofensivo — nada las lee — y no se corrige: la 1b-b las borra.
    expect(CAMPOS.map((c) => [c, orden[c]])).toStrictEqual([
      ['horaRecogidaTipo', 'LO_ANTES_POSIBLE'],
      ['horaRecogida', null],
      ['metodoEntrega', 'RECOGER'],
      ['puntoEnvioId', null],
      ['direccionCalle', null],
      ['direccionNumero', null],
      ['direccionColonia', null],
      ['direccionReferencias', null],
      ['notasDescuento', null],
    ]);
    expect(d).toMatchObject({
      metodoEntrega: 'DOMICILIO',
      puntoEnvioId: punto.id,
      direccionCalle: 'Calle Roble',
      notasDescuento: 'Café americano x2 (-10%)',
      horaRecogidaTipo: 'LO_ANTES_POSIBLE',
      horaRecogida: null,
    });
  });

  it('RECOGER con hora específica: detalle con la hora y sin entrega', async () => {
    const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '10:30' }));
    await waitForCalls(s.h.fakes.queueAdd);
    const d = await s.h.prisma.detalleB2C.findUniqueOrThrow({ where: { orderId: res.body.id } });
    expect(d).toMatchObject({
      horaRecogidaTipo: 'HORA_ESPECIFICA',
      horaRecogida: '10:30',
      metodoEntrega: 'RECOGER',
      puntoEnvioId: null,
      direccionCalle: null,
      notasDescuento: null,
    });
  });

  it('TARJETA: el detalle también se crea (rama con PaymentIntent)', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const { order } = await crearPedidoTarjeta(s.h, s.base, { horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '10:45' });
    const d = await s.h.prisma.detalleB2C.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(d.horaRecogida).toBe('10:45');
  });

  it('1:1 garantizado en base: un segundo detalle para la misma orden es rechazado', async () => {
    const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    await waitForCalls(s.h.fakes.queueAdd);
    await expect(
      s.h.prisma.detalleB2C.create({ data: { tenantId: s.base.tenant.id, orderId: res.body.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('al borrar la orden se borra su detalle (cascada)', async () => {
    const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    await waitForCalls(s.h.fakes.queueAdd);
    expect(await s.h.prisma.detalleB2C.count()).toBe(1);
    await s.h.prisma.order.delete({ where: { id: res.body.id } });
    expect(await s.h.prisma.detalleB2C.count()).toBe(0);
  });

  it('el detalle está registrado en TenantPrismaService: un tenant no ve detalles ajenos', async () => {
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    await waitForCalls(s.h.fakes.queueAdd);
    const { seedBase } = await import('./db');
    const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
    await postCheckout(s.h, otro.tenant.slug, bodyCheckout(otro));
    await waitForCalls(s.h.fakes.queueAdd, 2);
    // vía HTTP, /orders de cada tenant solo trae lo suyo (detalle incluido por include)
    const a = await auth(s.h, tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO')).get('/orders').expect(200);
    expect(a.body).toHaveLength(1);
    expect(await s.h.prisma.detalleB2C.count()).toBe(2);
    await cederEventLoop();
  });
});
