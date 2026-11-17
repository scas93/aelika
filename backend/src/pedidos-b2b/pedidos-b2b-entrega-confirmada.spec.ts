import { PedidosB2bService } from './pedidos-b2b.service';

jest.mock('./pedidos-b2b-estados', () => ({
  ...jest.requireActual('./pedidos-b2b-estados'),
  recalcularEstadoB2b: jest.fn().mockResolvedValue(undefined),
  recalcularTotalesB2b: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./pedidos-b2b-orden', () => ({
  ...jest.requireActual('./pedidos-b2b-orden'),
  aRespuestaPedidoB2b: jest.fn((x: unknown) => x),
}));

/** Disparo del correo «Entrega confirmada» desde los dos únicos lugares donde una entrega pasa a Entregada. */
function montar(estadoActual: string) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    order: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ estadoPedido: 'CONFIRMADO_SURTIENDO', cancelado: false, tenantId: 't1' }),
    },
    entrega: {
      findFirst: jest.fn().mockResolvedValue({ estado: estadoActual, items: [] }),
      update: jest.fn().mockResolvedValue({}),
    },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    detalleB2B: { update: jest.fn() },
  };
  const tenantPrisma = {
    client: { $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) },
  };
  const avisar = jest.fn().mockResolvedValue(undefined);
  const servicio = new PedidosB2bService(
    {} as never,
    tenantPrisma as never,
    {} as never,
    {} as never,
    { avisarSeguro: avisar } as never,
  );
  jest
    .spyOn(servicio as unknown as { cargar: () => Promise<unknown> }, 'cargar')
    .mockResolvedValue({ id: 'p1', tenantId: 't1' });
  return { servicio, avisar, tx };
}

describe('PedidosB2bService → correo «Entrega confirmada»', () => {
  it('cerrar una entrega como Entregada lo dispara una vez, con el tenant y la entrega', async () => {
    const { servicio, avisar } = montar('PENDIENTE');
    await servicio.cerrarEntrega('p1', 'e1', { estado: 'ENTREGADA' } as never);
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar).toHaveBeenCalledWith('t1', 'e1');
  });

  it('cerrarla como No recogida no lo dispara', async () => {
    const { servicio, avisar } = montar('PENDIENTE');
    await servicio.cerrarEntrega('p1', 'e1', { estado: 'NO_RECOGIDA' } as never);
    expect(avisar).not.toHaveBeenCalled();
  });

  it('si el cierre falla (entrega ya cerrada) no se dispara', async () => {
    const { servicio, avisar } = montar('ENTREGADA');
    await expect(
      servicio.cerrarEntrega('p1', 'e1', { estado: 'ENTREGADA' } as never),
    ).rejects.toThrow();
    expect(avisar).not.toHaveBeenCalled();
  });

  it('un fallo del aviso no revierte ni rompe el cierre', async () => {
    const { servicio, avisar } = montar('PENDIENTE');
    avisar.mockRejectedValue(new Error('boom'));
    await expect(
      servicio.cerrarEntrega('p1', 'e1', { estado: 'ENTREGADA' } as never),
    ).resolves.toBeDefined();
  });

  it('corregir de No recogida a Entregada lo dispara; corregir sin cambio de estado, no', async () => {
    const a = montar('NO_RECOGIDA');
    await a.servicio.corregirEntrega('p1', 'e1', { items: [], estado: 'ENTREGADA' } as never);
    expect(a.avisar).toHaveBeenCalledWith('t1', 'e1');

    const b = montar('ENTREGADA');
    await b.servicio.corregirEntrega('p1', 'e1', { items: [], estado: 'ENTREGADA' } as never);
    expect(b.avisar).not.toHaveBeenCalled();

    const c = montar('ENTREGADA');
    await c.servicio.corregirEntrega('p1', 'e1', { items: [], estado: 'NO_RECOGIDA' } as never);
    expect(c.avisar).not.toHaveBeenCalled();
  });
});
