import { ConflictException } from '@nestjs/common';
import { EstadoEntrega } from '../../generated/prisma/client';
import {
  sincronizarOrdenB2b,
  validarFechasSinEntrega,
} from './pedidos-b2b-orden';

const f = (s: string) => new Date(`${s}T00:00:00.000Z`);

function txCon(bloqueados: { fecha: Date; nota: string | null }[]) {
  const findMany = jest.fn().mockResolvedValue(bloqueados);
  return { tx: { diaSinEntrega: { findMany } } as never, findMany };
}

async function rechazo(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as ConflictException;
  }
  throw new Error('no rechazó');
}

describe('validarFechasSinEntrega (regla del backend)', () => {
  it('rechaza con 409 DIA_SIN_ENTREGA, la fecha tal cual (sin recorrerse) y la nota', async () => {
    const { tx } = txCon([{ fecha: f('2026-12-25'), nota: 'Navidad' }]);
    const e = await rechazo(
      validarFechasSinEntrega(tx, 't1', [f('2026-12-24'), f('2026-12-25')]),
    );
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.getStatus()).toBe(409);
    const r = e.getResponse() as Record<string, any>;
    expect(r.code).toBe('DIA_SIN_ENTREGA');
    expect(r.fechas).toEqual([
      {
        fecha: '2026-12-25',
        motivo: 'SIN_ENTREGA',
        mensaje: 'El vie 25 de dic es un día sin entrega (Navidad)',
      },
    ]);
    expect(r.message).toContain('vie 25 de dic');
    expect(r.message).toContain('quítalo de Ajustes');
  });

  it('sin nota no pone paréntesis; con varias fechas las lista todas', async () => {
    const { tx } = txCon([
      { fecha: f('2026-12-25'), nota: null },
      { fecha: f('2027-01-01'), nota: 'Año Nuevo' },
    ]);
    const e = await rechazo(
      validarFechasSinEntrega(tx, 't1', [f('2026-12-25'), f('2027-01-01')]),
    );
    const r = e.getResponse() as Record<string, any>;
    expect(r.fechas).toHaveLength(2);
    expect(r.fechas[0].mensaje).toBe('El vie 25 de dic es un día sin entrega');
  });

  it('aislamiento: la consulta va siempre acotada al negocio y a esas fechas', async () => {
    const { tx, findMany } = txCon([]);
    await validarFechasSinEntrega(tx, 'negocio-A', [f('2026-12-25')]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'negocio-A', fecha: { in: [f('2026-12-25')] } },
      }),
    );
  });

  it('sin fechas ni consulta; sin bloqueos no lanza', async () => {
    const { tx, findMany } = txCon([]);
    await validarFechasSinEntrega(tx, 't1', []);
    expect(findMany).not.toHaveBeenCalled();
    await expect(
      validarFechasSinEntrega(tx, 't1', [f('2026-12-26')]),
    ).resolves.toBeUndefined();
  });
});

describe('sincronizarOrdenB2b: solo valida las fechas NUEVAS', () => {
  it('una entrega existente en un festivo no se revalida; la fecha nueva sí', async () => {
    const findDias = jest
      .fn()
      .mockResolvedValue([{ fecha: f('2026-12-26'), nota: null }]);
    const tx = {
      orderItem: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'oi1', productId: 'p1', entregaItems: [] },
        ]),
        update: jest.fn(),
      },
      entrega: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'e1',
            fecha: f('2026-12-25'),
            estado: EstadoEntrega.PENDIENTE,
            items: [],
          },
        ]),
        create: jest.fn(),
        delete: jest.fn(),
      },
      diaSinEntrega: { findMany: findDias },
    };
    const items = [
      {
        productId: 'p1',
        nombreProducto: 'Pan',
        precioUnitario: 10,
        cantidadTotal: 4,
        distribucion: [
          { dia: 'VIERNES', cantidad: 2 }, // 2026-12-25: ya existía
          { dia: 'SABADO', cantidad: 2 }, // 2026-12-26: nueva
        ],
      },
    ] as never;
    const e = await rechazo(
      sincronizarOrdenB2b(tx as never, 't1', 'o1', f('2026-12-21'), items),
    );
    expect((e.getResponse() as Record<string, any>).code).toBe('DIA_SIN_ENTREGA');
    expect(findDias).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1', fecha: { in: [f('2026-12-26')] } },
      }),
    );
    expect(tx.entrega.create).not.toHaveBeenCalled();
  });
});
