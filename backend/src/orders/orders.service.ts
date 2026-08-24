import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { EstadoPedido } from '../../generated/prisma/enums';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';

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
