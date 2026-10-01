import { seedBase } from './db';
import { bodyCheckout, postCheckout, usarSuite } from './helpers';
import { waitForCalls } from './harness';

// Área 4 · Efecto en Cliente: alta, recompra, normalización de teléfono, correo no se pisa con vacío.
describe('B2C · Cliente derivado del pedido', () => {
  const s = usarSuite();

  it('alta: crea el Cliente B2C con primer/último pedido = ahora y totalPedidos 1', async () => {
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteCorreo: 'ana@test.com' }));
    const clientes = await s.h.prisma.cliente.findMany();
    expect(clientes).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(clientes[0]))).toEqual({
      id: clientes[0].id,
      tenantId: s.base.tenant.id,
      canal: 'B2C',
      telefono: '5511112222',
      nombre: 'Ana Prueba',
      correo: 'ana@test.com',
      primerPedidoAt: '2026-09-30T16:00:00.000Z',
      ultimoPedidoAt: '2026-09-30T16:00:00.000Z',
      totalPedidos: 1,
      createdAt: '2026-09-30T16:00:00.000Z',
      updatedAt: '2026-09-30T16:00:00.000Z',
    });
    await waitForCalls(s.h.fakes.queueAdd);
  });

  it('recompra: mismo teléfono en otro formato = mismo Cliente; sube totalPedidos, ultimoPedidoAt y pisa nombre', async () => {
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: '+52 55 1111 2222' }));
    jest.setSystemTime(new Date('2026-09-30T18:00:00.000Z'));
    const r2 = await postCheckout(
      s.h,
      s.base.tenant.slug,
      bodyCheckout(s.base, { clienteTelefono: '55-1111-2222', clienteNombre: 'Ana P. Nueva' }),
    );
    jest.setSystemTime(new Date('2026-09-30T19:00:00.000Z'));
    const r3 = await postCheckout(
      s.h,
      s.base.tenant.slug,
      bodyCheckout(s.base, { clienteTelefono: '+52 1 55 1111 2222' }), // lada de país + "1" viejo: últimos 10 dígitos
    );

    const clientes = await s.h.prisma.cliente.findMany();
    expect(clientes).toHaveLength(1);
    expect(clientes[0]).toMatchObject({ telefono: '5511112222', nombre: 'Ana Prueba', totalPedidos: 3 });
    expect(clientes[0].primerPedidoAt.toISOString()).toBe('2026-09-30T16:00:00.000Z');
    expect(clientes[0].ultimoPedidoAt.toISOString()).toBe('2026-09-30T19:00:00.000Z');
    // Los 3 pedidos apuntan al mismo Cliente; cada uno conserva su snapshot crudo.
    const ordenes = await s.h.prisma.order.findMany({ orderBy: { folio: 'asc' } });
    expect(ordenes.map((o) => o.clienteId)).toEqual([clientes[0].id, clientes[0].id, clientes[0].id]);
    expect(ordenes.map((o) => o.clienteTelefono)).toEqual(['+52 55 1111 2222', '55-1111-2222', '+52 1 55 1111 2222']);
    expect(r2.body.clienteId).toBe(r3.body.clienteId);
    await waitForCalls(s.h.fakes.queueAdd, 3);
  });

  it('el nombre del último pedido pisa al anterior', async () => {
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteNombre: 'Ana Uno' }));
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteNombre: 'Ana Dos' }));
    expect((await s.h.prisma.cliente.findMany())[0].nombre).toBe('Ana Dos');
    await waitForCalls(s.h.fakes.queueAdd, 2);
  });

  it('el correo no se pisa con vacío: un pedido sin correo conserva el anterior; uno con correo lo reemplaza', async () => {
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteCorreo: 'uno@test.com' }));
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base)); // sin correo
    expect((await s.h.prisma.cliente.findMany())[0].correo).toBe('uno@test.com');
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteCorreo: 'dos@test.com' }));
    expect((await s.h.prisma.cliente.findMany())[0].correo).toBe('dos@test.com');
    // El snapshot del pedido sin correo sí queda null.
    const ordenes = await s.h.prisma.order.findMany({ orderBy: { folio: 'asc' } });
    expect(ordenes.map((o) => o.clienteCorreo)).toEqual(['uno@test.com', null, 'dos@test.com']);
    await waitForCalls(s.h.fakes.queueAdd, 3);
  });

  it('el mismo teléfono en tenants distintos son Clientes distintos', async () => {
    const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    await postCheckout(s.h, otro.tenant.slug, bodyCheckout(otro));
    const clientes = await s.h.prisma.cliente.findMany();
    expect(clientes).toHaveLength(2);
    expect(new Set(clientes.map((c) => c.tenantId)).size).toBe(2);
    await waitForCalls(s.h.fakes.queueAdd, 2);
  });

  it('teléfonos distintos = Clientes distintos', async () => {
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: '5511112222' }));
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: '5533334444' }));
    expect(await s.h.prisma.cliente.count()).toBe(2);
    await waitForCalls(s.h.fakes.queueAdd, 2);
  });

  // A2 (cambia a propósito): un pedido TARJETA que falla al crear el PaymentIntent ya NO cuenta en totalPedidos.
  it('un pedido TARJETA que luego falla NO cuenta en totalPedidos del Cliente (queda en 0, con fecha de alta)', async () => {
    // El Cliente se sincroniza al crear el pedido, antes de saber si el pago prospera.
    const { conectarStripe } = await import('./db');
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    s.h.fakes.paymentIntentsCreate.mockRejectedValueOnce(new Error('stripe caído'));
    const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { metodoPago: 'TARJETA' }));
    // Parte B1 (cambia a propósito): fallo al crear el PaymentIntent → 503 con mensaje claro, ya no un 500 sin manejar.
    expect(res.status).toBe(503);
    expect(res.body.message).toBe('No pudimos iniciar el pago con tarjeta, intenta de nuevo');
    const clientes = await s.h.prisma.cliente.findMany();
    expect(clientes).toHaveLength(1);
    expect(clientes[0].totalPedidos).toBe(0);
    expect(clientes[0].primerPedidoAt).toStrictEqual(clientes[0].createdAt);
    expect(clientes[0].ultimoPedidoAt).toStrictEqual(clientes[0].createdAt);
    // ...y el pedido quedó registrado como FALLIDO, no se pierde.
    const orden = await s.h.prisma.order.findMany();
    expect(orden).toHaveLength(1);
    expect(orden[0].estadoPago).toBe('FALLIDO');
  });
});
