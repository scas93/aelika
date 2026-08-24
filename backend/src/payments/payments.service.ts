import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { ExportPaymentsQueryDto } from './dto/export-payments-query.dto';
import { toCsv } from '../common/csv';

@Injectable()
export class PaymentsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  private buildWhere(query: {
    status?: ListPaymentsQueryDto['status'];
    paymentMethodType?: string;
    desde?: string;
    hasta?: string;
  }): Prisma.PaymentWhereInput {
    return {
      status: query.status,
      paymentMethodType: query.paymentMethodType,
      createdAt:
        query.desde || query.hasta
          ? {
              gte: query.desde ? new Date(query.desde) : undefined,
              lte: query.hasta ? new Date(query.hasta) : undefined,
            }
          : undefined,
    };
  }

  async findAll(query: ListPaymentsQueryDto) {
    const where = this.buildWhere(query);
    const skip = (query.page - 1) * query.limit;

    const [rows, total] = await Promise.all([
      this.tenantPrisma.client.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.limit,
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          paymentMethodType: true,
          cardBrand: true,
          last4: true,
          capturedAt: true,
          createdAt: true,
          order: { select: { folio: true } },
        },
      }),
      this.tenantPrisma.client.payment.count({ where }),
    ]);

    // order.folio flattened onto each row (folio: string) instead of a
    // nested `order` object — same flat shape ListOrdersHistorico already
    // returns for its own fields.
    const data = rows.map(({ order, ...payment }) => ({ ...payment, folio: order.folio }));

    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async exportCsv(query: ExportPaymentsQueryDto): Promise<string> {
    const where = this.buildWhere(query);

    const payments = await this.tenantPrisma.client.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        amount: true,
        currency: true,
        status: true,
        paymentMethodType: true,
        capturedAt: true,
        order: { select: { folio: true } },
      },
    });

    return toCsv(payments, [
      { header: 'Folio', value: (p) => p.order.folio },
      { header: 'Monto', value: (p) => Number(p.amount).toFixed(2) },
      { header: 'Moneda', value: (p) => p.currency },
      { header: 'Estado', value: (p) => p.status },
      { header: 'Método', value: (p) => p.paymentMethodType },
      { header: 'Fecha de captura', value: (p) => p.capturedAt?.toISOString() ?? '' },
    ]);
  }
}
