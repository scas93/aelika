import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { estadoB2bVisible } from '../pedidos-b2b/pedidos-b2b-estados';
import { CreateDiaSinEntregaDto } from './dto/create-dia-sin-entrega.dto';

const PRISMA_UNIQUE = 'P2002';

const aISO = (d: Date) => d.toISOString().slice(0, 10);

/** "YYYY-MM-DD" → medianoche UTC (el formato de `@db.Date`); null si no es una fecha real (p. ej. 2026-02-30). */
function fechaDeCalendario(texto: string): Date | null {
  const d = new Date(`${texto}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || aISO(d) !== texto ? null : d;
}

/**
 * Días sin entrega (festivos) de un negocio B2B. Lectura: los 3 roles (el panel necesita la lista para bloquear fechas).
 * Escritura: Gerente/Dueño (ver el controlador). Todo va por TenantPrismaService, así que nunca ve ni toca otro negocio.
 */
@Injectable()
export class DiasSinEntregaService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  async findAll() {
    const filas = await this.tenantPrisma.client.diaSinEntrega.findMany({ orderBy: { fecha: 'asc' } });
    return filas.map((f) => ({ id: f.id, fecha: aISO(f.fecha), nota: f.nota }));
  }

  /**
   * Marca una fecha. No toca ninguna entrega: devuelve cuántas entregas vigentes (no canceladas) y de qué clientes hay ya
   * programadas ese día, para que el equipo las resuelva con ellos.
   */
  async create(dto: CreateDiaSinEntregaDto) {
    const fecha = fechaDeCalendario(dto.fecha);
    if (!fecha) throw new BadRequestException('La fecha no es válida');
    const db = this.tenantPrisma.client;
    if (await db.diaSinEntrega.findFirst({ where: { fecha }, select: { id: true } })) {
      throw new ConflictException('Esa fecha ya está en la lista de días sin entrega');
    }
    let dia;
    try {
      // tenantId lo inyecta la extensión (ver TenantPrismaService).
      dia = await db.diaSinEntrega.create({ data: { fecha, nota: dto.nota?.trim() || null } as any });
    } catch (e) {
      if ((e as { code?: string }).code === PRISMA_UNIQUE) {
        throw new ConflictException('Esa fecha ya está en la lista de días sin entrega');
      }
      throw e;
    }
    const entregas = await db.entrega.findMany({
      where: { fecha, estado: { not: 'CANCELADA' }, order: { tipo: 'B2B', cancelado: false } },
      select: {
        order: {
          select: {
            folio: true,
            clienteNombre: true,
            estadoPedido: true,
            estadoPago: true,
            detalleB2b: { select: { negocioNombre: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      dia: { id: dia.id, fecha: aISO(dia.fecha), nota: dia.nota },
      afectadas: {
        total: entregas.length,
        entregas: entregas.map(({ order: o }) => ({
          folio: o.folio,
          cliente: o.detalleB2b?.negocioNombre || o.clienteNombre,
          estadoPedido: estadoB2bVisible(o.estadoPedido),
          pagado: o.estadoPago === 'PAGADO',
        })),
      },
    };
  }

  async remove(id: string) {
    const db = this.tenantPrisma.client;
    const dia = await db.diaSinEntrega.findFirst({ where: { id }, select: { id: true } });
    if (!dia) throw new NotFoundException('Día sin entrega no encontrado');
    await db.diaSinEntrega.delete({ where: { id } });
  }
}
