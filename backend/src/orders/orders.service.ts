import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { EstadoPedido } from '../../generated/prisma/enums';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';

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
    const order = await this.tenantPrisma.client.order.findUnique({ where: { id } });
    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const siguiente = SIGUIENTE_ESTADO[order.estadoPedido as EstadoPedido];
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
