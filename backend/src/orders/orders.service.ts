import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { EstadoPedido } from '../../generated/prisma/enums';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';
import { ListOrdersHistoricoQueryDto } from './dto/list-orders-historico-query.dto';
import { ExportOrdersHistoricoQueryDto } from './dto/export-orders-historico-query.dto';
import { toCsv } from '../common/csv';

// Sequential, one-way status flow (see CLAUDE.md) — no arbitrary jumps, no
// going back. DESPACHADO has no next step.
const SIGUIENTE_ESTADO: Record<EstadoPedido, EstadoPedido | null> = {
  [EstadoPedido.PENDIENTE_CONFIRMACION]: EstadoPedido.CONFIRMADO_SURTIENDO,
  [EstadoPedido.CONFIRMADO_SURTIENDO]: EstadoPedido.LISTO_ENTREGA,
  [EstadoPedido.LISTO_ENTREGA]: EstadoPedido.DESPACHADO,
  [EstadoPedido.DESPACHADO]: null,
};

@Injectable()
export class OrdersService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  findAll(query: ListOrdersQueryDto) {
    return this.tenantPrisma.client.order.findMany({
      where: {
        estadoPedido: query.estadoPedido,
        createdAt:
          query.desde || query.hasta
            ? {
                gte: query.desde ? new Date(query.desde) : undefined,
                lte: query.hasta ? new Date(query.hasta) : undefined,
              }
            : undefined,
      },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }

  async summary(query: SummaryQueryDto) {
    const where = {
      createdAt: { gte: new Date(query.desde), lte: new Date(query.hasta) },
    };

    const [aggregate, promocionesActivas] = await Promise.all([
      this.tenantPrisma.client.order.aggregate({
        where,
        _count: true,
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.tenantPrisma.client.promotion.count({ where: { activa: true } }),
    ]);

    return {
      pedidosHoy: aggregate._count,
      // _sum/_avg come back null (not 0) when there are no matching rows —
      // normalized here so the frontend never has to special-case pedidosHoy = 0.
      ingresosHoy: (aggregate._sum.total ?? 0).toFixed(2),
      ticketPromedioHoy: (aggregate._avg.total ?? 0).toFixed(2),
      promocionesActivas,
    };
  }

  // Reuses the exact "hoy" boundary the frontend already sends to /orders/summary
  // (see CLAUDE.md, Fase 9b) instead of computing "today" independently on the
  // server — desde/hasta get shifted back whole days at a time, which preserves
  // whatever UTC/local offset that boundary encodes for every one of the 10 days.
  async summaryDaily(query: SummaryQueryDto) {
    const DIAS = 10;
    const DIA_MS = 24 * 60 * 60 * 1000;
    const desdeHoy = new Date(query.desde);
    const hastaHoy = new Date(query.hasta);

    const dias = Array.from({ length: DIAS }, (_, i) => {
      const offsetMs = (DIAS - 1 - i) * DIA_MS;
      const desde = new Date(desdeHoy.getTime() - offsetMs);
      const hasta = new Date(hastaHoy.getTime() - offsetMs);
      return { fecha: desde.toISOString().slice(0, 10), desde, hasta };
    });

    // Single query for the whole 10-day window (backed by the
    // (tenantId, createdAt) composite index) — grouped by day in memory
    // instead of $queryRaw, per the volume confirmed in Fase 9a/10a.
    const orders = await this.tenantPrisma.client.order.findMany({
      where: { createdAt: { gte: dias[0].desde, lte: hastaHoy } },
      select: { createdAt: true },
    });

    return dias.map(({ fecha, desde, hasta }) => ({
      fecha,
      pedidos: orders.filter(
        (o) => o.createdAt >= desde && o.createdAt <= hasta,
      ).length,
    }));
  }

  private buildHistoricoWhere(query: {
    estadoPedido?: EstadoPedido;
    metodoPago?: ListOrdersHistoricoQueryDto['metodoPago'];
    desde?: string;
    hasta?: string;
  }): Prisma.OrderWhereInput {
    return {
      estadoPedido: query.estadoPedido,
      metodoPago: query.metodoPago,
      createdAt:
        query.desde || query.hasta
          ? {
              gte: query.desde ? new Date(query.desde) : undefined,
              lte: query.hasta ? new Date(query.hasta) : undefined,
            }
          : undefined,
    };
  }

  async findAllHistorico(query: ListOrdersHistoricoQueryDto) {
    const where = this.buildHistoricoWhere(query);
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
        select: {
          id: true,
          folio: true,
          clienteNombre: true,
          createdAt: true,
          estadoPedido: true,
          metodoPago: true,
          total: true,
        },
      }),
      this.tenantPrisma.client.order.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async exportHistoricoCsv(query: ExportOrdersHistoricoQueryDto): Promise<string> {
    const where = this.buildHistoricoWhere(query);

    const orders = await this.tenantPrisma.client.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        folio: true,
        clienteNombre: true,
        createdAt: true,
        estadoPedido: true,
        metodoPago: true,
        total: true,
      },
    });

    return toCsv(orders, [
      { header: 'Folio', value: (o) => o.folio },
      { header: 'Cliente', value: (o) => o.clienteNombre },
      { header: 'Fecha', value: (o) => o.createdAt.toISOString() },
      { header: 'Estado', value: (o) => o.estadoPedido },
      { header: 'Método de pago', value: (o) => o.metodoPago },
      { header: 'Total', value: (o) => Number(o.total).toFixed(2) },
    ]);
  }

  async findOne(id: string) {
    const order = await this.tenantPrisma.client.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }
    return order;
  }

  async avanzar(id: string) {
    const order = await this.tenantPrisma.client.order.findUnique({
      where: { id },
    });
    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const siguiente = SIGUIENTE_ESTADO[order.estadoPedido];
    if (!siguiente) {
      throw new ConflictException('Este pedido ya está despachado');
    }

    return this.tenantPrisma.client.order.update({
      where: { id },
      data: { estadoPedido: siguiente },
      include: { items: true },
    });
  }
}
