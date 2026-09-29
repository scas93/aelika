import request from 'supertest';
import { waitForCalls } from './harness';
import { etiquetasOrder, expectExacto, ordenEsperada } from './exacto';
import { bodyCheckout, usarSuite } from './helpers';

// Área 1 · caso base: checkout EFECTIVO / RECOGER (respuesta con igualdad estricta).
describe('B2C · checkout EFECTIVO (caso base)', () => {
  const s = usarSuite();

  it('crea el pedido: respuesta exacta, filas y efecto en Cliente', async () => {
    const res = await request(s.h.app.getHttpServer())
      .post(`/public/tenants/${s.base.tenant.slug}/orders`)
      .send(bodyCheckout(s.base, { items: [{ productId: s.base.productoA.id, cantidad: 2 }] }));

    expect(res.status).toBe(201);
    const cliente = await s.h.prisma.cliente.findMany();
    expect(cliente).toHaveLength(1);

    expectExacto(
      res.body,
      ordenEsperada(
        {
          descuentoTotal: '0', // Decimal serializado como string, sin ceros de relleno
          total: '90',
          items: [{ id: '<uuid>', tenantId: '<tenant>', orderId: '<order>', productId: '<productoA>', nombreProducto: 'Café americano', precioUnitario: '45', cantidad: 2, modificadores: [] }],
        },
        { mod: true },
      ),
      etiquetasOrder(s.base, res.body),
    );

    expect(await s.h.prisma.order.count()).toBe(1);
    expect(await s.h.prisma.orderItem.count()).toBe(1);
    expect(cliente[0]).toMatchObject({
      tenantId: s.base.tenant.id,
      canal: 'B2C',
      telefono: '5511112222', // normalizado: últimos 10 dígitos
      nombre: 'Ana Prueba',
      correo: null,
      totalPedidos: 1,
    });
    expect(res.body.clienteId).toBe(cliente[0].id);

    await waitForCalls(s.h.fakes.queueAdd);
    expect(s.h.fakes.queueAdd).toHaveBeenCalledTimes(1);
    const [, data] = s.h.fakes.queueAdd.mock.calls[0];
    expect(data).toMatchObject({
      tenantId: s.base.tenant.id,
      evento: 'PEDIDO_RECIBIDO',
      mensaje: { asunto: 'Nuevo pedido #1' },
    });
    expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
    expect(s.h.fakes.paymentIntentsCreate).not.toHaveBeenCalled();
  });
});
