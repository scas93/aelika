import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '../../generated/prisma/enums';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { DiasSinEntregaController } from './dias-sin-entrega.controller';
import { DiasSinEntregaService } from './dias-sin-entrega.service';

const f = (s: string) => new Date(`${s}T00:00:00.000Z`);

function servicio(opciones: { existente?: boolean; entregas?: unknown[] } = {}) {
  const db = {
    diaSinEntrega: {
      findMany: jest.fn().mockResolvedValue([{ id: 'd1', fecha: f('2026-12-25'), nota: 'Navidad' }]),
      findFirst: jest.fn().mockResolvedValue(opciones.existente ? { id: 'd1' } : null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'd2', ...data })),
      delete: jest.fn().mockResolvedValue({}),
    },
    entrega: {
      findMany: jest.fn().mockResolvedValue(opciones.entregas ?? []),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  };
  return { db, service: new DiasSinEntregaService({ client: db } as never) };
}

describe('DiasSinEntregaService', () => {
  it('lista fechas como YYYY-MM-DD sin recorrerlas', async () => {
    const { service } = servicio();
    await expect(service.findAll()).resolves.toEqual([{ id: 'd1', fecha: '2026-12-25', nota: 'Navidad' }]);
  });

  it('marca una fecha sin tocar ninguna entrega y avisa de las afectadas (cuántas y de qué clientes)', async () => {
    const { db, service } = servicio({
      entregas: [
        {
          order: {
            folio: 'B-0007',
            clienteNombre: 'Ana',
            estadoPedido: 'CONFIRMADO_SURTIENDO',
            estadoPago: 'PAGADO',
            detalleB2b: { negocioNombre: 'Cafetería Sol' },
          },
        },
        {
          order: { folio: 'B-0009', clienteNombre: 'Luis', estadoPedido: 'PENDIENTE_CONFIRMACION', estadoPago: 'PENDIENTE', detalleB2b: null },
        },
      ],
    });
    const r = await service.create({ fecha: '2026-12-25', nota: ' Navidad ' });
    expect(r.dia).toEqual({ id: 'd2', fecha: '2026-12-25', nota: 'Navidad' });
    expect(r.afectadas.total).toBe(2);
    expect(r.afectadas.entregas.map((e) => [e.folio, e.cliente, e.pagado])).toEqual([
      ['B-0007', 'Cafetería Sol', true],
      ['B-0009', 'Luis', false],
    ]);
    // La consulta de afectadas es solo B2B, de esa fecha, sin canceladas ni pedidos cancelados.
    expect(db.entrega.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fecha: f('2026-12-25'), estado: { not: 'CANCELADA' }, order: { tipo: 'B2B', cancelado: false } },
      }),
    );
    expect(db.entrega.update).not.toHaveBeenCalled();
    expect(db.entrega.updateMany).not.toHaveBeenCalled();
    expect(db.entrega.delete).not.toHaveBeenCalled();
  });

  it('sin entregas ese día: afectadas vacío', async () => {
    const { service } = servicio();
    const r = await service.create({ fecha: '2026-12-25' });
    expect(r.dia.nota).toBeNull();
    expect(r.afectadas).toEqual({ total: 0, entregas: [] });
  });

  it('acepta fechas pasadas', async () => {
    const { service } = servicio();
    await expect(service.create({ fecha: '2020-01-01' })).resolves.toBeDefined();
  });

  it('rechaza fechas que no existen (400) y fechas repetidas (409)', async () => {
    await expect(servicio().service.create({ fecha: '2026-02-30' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio({ existente: true }).service.create({ fecha: '2026-12-25' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('aislamiento: quitar el día de otro negocio (no visible con el cliente del tenant) da 404 y no borra', async () => {
    const { db, service } = servicio({ existente: false });
    await expect(service.remove('d-ajeno')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.diaSinEntrega.delete).not.toHaveBeenCalled();
  });

  it('quita un día propio', async () => {
    const { db, service } = servicio({ existente: true });
    await service.remove('d1');
    expect(db.diaSinEntrega.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });
});

describe('DiasSinEntregaController: roles', () => {
  const roles = (metodo: keyof DiasSinEntregaController) =>
    Reflect.getMetadata(ROLES_KEY, DiasSinEntregaController.prototype[metodo]) as Role[] | undefined;

  it('marcar y quitar: solo Gerente y Dueño (el Operador queda fuera)', () => {
    for (const m of ['create', 'remove'] as const) {
      expect(roles(m)).toEqual([Role.GERENTE, Role.DUENO]);
      expect(roles(m)).not.toContain(Role.OPERADOR);
    }
  });

  it('leer la lista: sin restricción de rol (los 3 roles)', () => {
    expect(roles('findAll')).toBeUndefined();
  });
});
