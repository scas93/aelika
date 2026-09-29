import { tokenFor } from './auth';
import { conectarStripe } from './db';
import { apiRol, crearPublicoB2b } from './b2b-helpers';
import { auth, bodyCheckout, crearPedidoTarjeta, eventoPaymentIntent, postCheckout, postWebhook, usarSuite } from './helpers';

// Pedidos TARJETA no pagados · A2: contadores de Cliente derivados de pedidos contables
// (B2C = Order PAGADO, B2B = PedidoB2b no cancelado). Fechas = createdAt del pedido;
// sin pedidos contables = totalPedidos 0 y fecha de alta del Cliente.
describe('Cliente · contadores derivados de pedidos contables', () => {
  const s = usarSuite();
  const dueno = () => auth(s.h, tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO'));
  const clientes = () => s.h.prisma.cliente.findMany({ orderBy: { createdAt: 'asc' } });
  const iso = (d: Date) => d.toISOString();
  const HOY = 'desde=2026-09-30T06:00:00.000Z&hasta=2026-10-01T05:59:59.999Z';

  it('EFECTIVO nace PAGADO: cuenta al crear (totalPedidos 1, fechas = pedido)', async () => {
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    const [c] = await clientes();
    expect(c.totalPedidos).toBe(1);
    expect(iso(c.primerPedidoAt)).toBe('2026-09-30T16:00:00.000Z');
    expect(iso(c.ultimoPedidoAt)).toBe('2026-09-30T16:00:00.000Z');
  });

  it('TARJETA: al crear NO cuenta (0, fecha de alta); al pagarse por el webhook cuenta con la fecha de CREACIÓN del pedido', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    jest.setSystemTime(new Date('2026-09-30T16:00:00.000Z'));
    const { piId } = await crearPedidoTarjeta(s.h, s.base);
    let [c] = await clientes();
    expect(c.totalPedidos).toBe(0);
    expect(c.primerPedidoAt).toStrictEqual(c.createdAt);
    expect(c.ultimoPedidoAt).toStrictEqual(c.createdAt);

    jest.setSystemTime(new Date('2026-09-30T19:00:00.000Z')); // se paga 3 h después
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
    [c] = await clientes();
    expect(c.totalPedidos).toBe(1);
    expect(iso(c.primerPedidoAt)).toBe('2026-09-30T16:00:00.000Z'); // createdAt del pedido, no la hora del pago
    expect(iso(c.ultimoPedidoAt)).toBe('2026-09-30T16:00:00.000Z');
  });

  it('webhook repetido (idempotente) y payment_failed no mueven los contadores', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const { piId } = await crearPedidoTarjeta(s.h, s.base);
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.payment_failed', piId, 4500)).expect(200);
    expect((await clientes())[0].totalPedidos).toBe(0);
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
    expect((await clientes())[0].totalPedidos).toBe(1);
  });

  it('intento no pagado tras un pedido pagado: el cliente sigue en 1 y ultimoPedidoAt no salta al intento', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base)); // EFECTIVO 16:00
    jest.setSystemTime(new Date('2026-09-30T18:00:00.000Z'));
    await crearPedidoTarjeta(s.h, s.base); // intento 18:00, nunca se paga
    const [c] = await clientes();
    expect(c.totalPedidos).toBe(1);
    expect(iso(c.ultimoPedidoAt)).toBe('2026-09-30T16:00:00.000Z');
  });

  it('reembolsar: el cliente pierde esa visita (vuelve a 0 y a la fecha de alta)', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const { order, piId } = await crearPedidoTarjeta(s.h, s.base);
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
    expect((await clientes())[0].totalPedidos).toBe(1);
    await dueno().post(`/orders/${order.id}/reembolsar`).expect(201);
    const [c] = await clientes();
    expect(c.totalPedidos).toBe(0);
    expect(c.primerPedidoAt).toStrictEqual(c.createdAt);
    expect(c.ultimoPedidoAt).toStrictEqual(c.createdAt);
  });

  it('cliente con solo intentos de pago: 0 pedidos, sigue en el directorio, fuera de activos, nuevos y top', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    await crearPedidoTarjeta(s.h, s.base);
    await crearPedidoTarjeta(s.h, s.base);
    expect((await clientes())[0].totalPedidos).toBe(0);
    const api = dueno();
    expect((await api.get('/clientes').expect(200)).body.total).toBe(1);
    expect((await api.get('/clientes?conPedidos=true').expect(200)).body.total).toBe(0);
    expect((await api.get('/clientes/activos').expect(200)).body).toStrictEqual({ clientesActivos: 0 });
    expect((await api.get(`/clientes/summary/daily?${HOY}`).expect(200)).body.at(-1)).toStrictEqual({ fecha: '2026-09-30', nuevos: 0, recurrentes: 0 });
    expect((await api.get(`/orders/summary?${HOY}`).expect(200)).body.pedidosHoy).toBe(0);
  });

  it('un REEMBOLSADO queda fuera de summary (pedidos e ingresos) pero visible en el panel activo (soloPagados)', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const { order, piId } = await crearPedidoTarjeta(s.h, s.base);
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', piId, 4500)).expect(200);
    expect((await dueno().get(`/orders/summary?${HOY}`).expect(200)).body.pedidosHoy).toBe(1);
    await dueno().post(`/orders/${order.id}/reembolsar`).expect(201);
    expect((await dueno().get(`/orders/summary?${HOY}`).expect(200)).body).toMatchObject({ pedidosHoy: 0, ingresosHoy: '0.00' });
    expect((await dueno().get('/orders?soloPagados=true').expect(200)).body).toHaveLength(1);
  });

  it('el mismo cliente con un intento no pagado y luego un pago: nombre/correo se siguen actualizando en cada intento', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    await crearPedidoTarjeta(s.h, s.base, { clienteNombre: 'Nombre Intento' });
    expect((await clientes())[0]).toMatchObject({ nombre: 'Nombre Intento', totalPedidos: 0 });
  });

  describe('B2B: cuenta por pedido no cancelado (no por estadoPago)', () => {
    it('crear cuenta al nacer (aunque estadoPago sea PENDIENTE); marcar pagado no cambia el conteo; cancelar lo quita', async () => {
      const p = await crearPublicoB2b(s.h, s.base);
      let [c] = await clientes();
      expect(c.canal).toBe('B2B');
      expect(c.totalPedidos).toBe(1);

      await apiRol(s.h, s.base, 'DUENO').patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      [c] = await clientes();
      expect(c.totalPedidos).toBe(1);

      await apiRol(s.h, s.base, 'DUENO').patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      [c] = await clientes();
      expect(c.totalPedidos).toBe(0);
      expect(c.primerPedidoAt).toStrictEqual(c.createdAt);
    });

    it('un pedido B2B no cuenta para un Cliente B2C con el mismo teléfono (canales separados)', async () => {
      await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: '5599990000' }));
      await crearPublicoB2b(s.h, s.base, { contactoTelefono: '5599990000' });
      const todos = await clientes();
      expect(todos.map((c) => `${c.canal}:${c.totalPedidos}`).sort()).toStrictEqual(['B2B:1', 'B2C:1']);
    });
  });
});
