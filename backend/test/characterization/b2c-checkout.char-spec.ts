import request from 'supertest';
import { createHarness, freezeClock, restoreClock, waitForCalls, Harness } from './harness';
import { BaseSeed, seedBase, truncateAll } from './db';
import { claves, normalizar } from './normalizar';

// Miércoles 2026-09-30 10:00 en Ciudad de México (UTC-6): dentro del horario
// 08:00-22:00 del tenant de prueba.
const AHORA = '2026-09-30T16:00:00.000Z';

describe('B2C · checkout EFECTIVO (punto de control)', () => {
  let h: Harness;
  let base: BaseSeed;

  beforeAll(async () => {
    freezeClock(AHORA);
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
    restoreClock();
  });
  beforeEach(async () => {
    await truncateAll(h.prisma);
    h.fakes.reset();
    base = await seedBase(h.prisma);
  });

  it('crea el pedido: respuesta con el conjunto exacto de claves, filas y efecto en Cliente', async () => {
    const res = await request(h.app.getHttpServer())
      .post(`/public/tenants/${base.tenant.slug}/orders`)
      .send({
        clienteNombre: 'Ana Prueba',
        clienteTelefono: '+52 55 1111 2222',
        metodoPago: 'EFECTIVO',
        horaRecogidaTipo: 'LO_ANTES_POSIBLE',
        items: [{ productId: base.productoA.id, cantidad: 2 }],
      });

    expect(res.status).toBe(201);

    // Conjunto EXACTO de claves: falla si el refactor agrega (p. ej. `tipo`) o quita un campo.
    expect(claves(res.body)).toEqual([
      'canalOrigen',
      'clienteCorreo',
      'clienteId',
      'clienteNombre',
      'clienteTelefono',
      'createdAt',
      'descuentoTotal',
      'direccionCalle',
      'direccionColonia',
      'direccionNumero',
      'direccionReferencias',
      'estadoPago',
      'estadoPedido',
      'facturaCodigoPostal',
      'facturaCorreo',
      'facturaRazonSocial',
      'facturaRegimenFiscal',
      'facturaRfc',
      'facturaUsoCfdi',
      'folio',
      'horaRecogida',
      'horaRecogidaTipo',
      'id',
      'items',
      'metodoEntrega',
      'metodoPago',
      'notas',
      'notasDescuento',
      'puntoEnvioId',
      'requiereFactura',
      'stripePaymentIntentId',
      'stripeRefundId',
      'tenantId',
      'total',
      'updatedAt',
    ]);
    expect(claves(res.body.items[0])).toEqual([
      'cantidad',
      'id',
      'modificadores',
      'nombreProducto',
      'orderId',
      'precioUnitario',
      'productId',
      'tenantId',
    ]);

    const cliente = await h.prisma.cliente.findMany();
    expect(cliente).toHaveLength(1);

    expect(
      normalizar(res.body, {
        [base.tenant.id]: 'tenant',
        [base.productoA.id]: 'productoA',
        [cliente[0].id]: 'cliente',
        [res.body.id]: 'order',
      }),
    ).toEqual({
      id: '<order>',
      tenantId: '<tenant>',
      folio: '1',
      clienteNombre: 'Ana Prueba',
      clienteTelefono: '+52 55 1111 2222', // snapshot crudo, sin normalizar
      clienteCorreo: null,
      clienteId: '<cliente>',
      notas: null,
      horaRecogidaTipo: 'LO_ANTES_POSIBLE',
      horaRecogida: null,
      metodoPago: 'EFECTIVO',
      estadoPago: 'PAGADO',
      stripePaymentIntentId: null,
      stripeRefundId: null,
      metodoEntrega: 'RECOGER',
      puntoEnvioId: null,
      direccionCalle: null,
      direccionNumero: null,
      direccionColonia: null,
      direccionReferencias: null,
      requiereFactura: false,
      facturaRazonSocial: null,
      facturaRfc: null,
      facturaRegimenFiscal: null,
      facturaUsoCfdi: null,
      facturaCodigoPostal: null,
      facturaCorreo: null,
      estadoPedido: 'PENDIENTE_CONFIRMACION',
      canalOrigen: 'WEB',
      descuentoTotal: '0', // Decimal serializado como string, sin ceros de relleno
      notasDescuento: null,
      total: '90',
      createdAt: '<iso>',
      updatedAt: '<iso>',
      items: [
        {
          id: '<uuid>',
          tenantId: '<tenant>',
          orderId: '<order>',
          productId: '<productoA>',
          nombreProducto: 'Café americano',
          precioUnitario: '45',
          cantidad: 2,
          modificadores: [],
        },
      ],
    });

    // Filas resultantes.
    expect(await h.prisma.order.count()).toBe(1);
    expect(await h.prisma.orderItem.count()).toBe(1);
    expect(cliente[0]).toMatchObject({
      tenantId: base.tenant.id,
      canal: 'B2C',
      telefono: '5511112222', // normalizado: últimos 10 dígitos
      nombre: 'Ana Prueba',
      correo: null,
      totalPedidos: 1,
    });
    expect(res.body.clienteId).toBe(cliente[0].id);

    // Fire-and-forget: se espera de forma determinística a que la cola reciba el job.
    await waitForCalls(h.fakes.queueAdd);
    expect(h.fakes.queueAdd).toHaveBeenCalledTimes(1);
    const [, data] = h.fakes.queueAdd.mock.calls[0];
    expect(data).toMatchObject({
      tenantId: base.tenant.id,
      evento: 'PEDIDO_RECIBIDO',
      mensaje: { asunto: 'Nuevo pedido #1' },
    });
    expect(h.fakes.dispararSeguro).not.toHaveBeenCalled();
    expect(h.fakes.paymentIntentsCreate).not.toHaveBeenCalled();
  });
});
