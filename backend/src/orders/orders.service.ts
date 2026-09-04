import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { NotificacionesQueueService } from '../notificaciones/queue/notificaciones-queue.service';
import {
  EstadoPago,
  EstadoPedido,
  MetodoPago,
  NotificacionEvento,
} from '../../generated/prisma/enums';
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

// Evento de notificación (audiencia CLIENTE) disparado por cada transición
// de avanzar() — solo las 3 que le importan al cliente final; la primera
// transición (PENDIENTE_CONFIRMACION -> CONFIRMADO_SURTIENDO ya cubierta
// abajo) no tiene un paso "anterior" que notificar aquí porque "pedido
// recibido" (audiencia NEGOCIO) se dispara en la creación, no en avanzar()
// — ver PublicService.createOrder.
const EVENTO_POR_ESTADO: Partial<Record<EstadoPedido, NotificacionEvento>> = {
  [EstadoPedido.CONFIRMADO_SURTIENDO]: NotificacionEvento.PEDIDO_CONFIRMADO,
  [EstadoPedido.LISTO_ENTREGA]: NotificacionEvento.PEDIDO_EN_CAMINO,
  [EstadoPedido.DESPACHADO]: NotificacionEvento.PEDIDO_ENTREGADO,
};

// Título/subtítulo amigables por evento para el correo HTML — ver
// construirCorreoHtmlPedido. subtitulo es opcional (solo PEDIDO_CONFIRMADO
// trae uno en el diseño validado); si falta, esa línea simplemente no se
// renderiza.
const EVENTO_TITULO: Record<NotificacionEvento, { titulo: string; subtitulo?: string }> = {
  [NotificacionEvento.PEDIDO_RECIBIDO]: { titulo: 'Pedido recibido' }, // no se usa aquí (audiencia NEGOCIO, ver PublicService)
  [NotificacionEvento.PAGO_CONFIRMADO]: { titulo: 'Pago confirmado' }, // no se usa aquí (audiencia NEGOCIO, ver StripeWebhookController)
  [NotificacionEvento.PEDIDO_CONFIRMADO]: {
    titulo: '🎉 ¡Tu pedido fue confirmado!',
    subtitulo: 'Ya lo estamos preparando',
  },
  [NotificacionEvento.PEDIDO_EN_CAMINO]: { titulo: '🚚 Tu pedido va en camino' },
  [NotificacionEvento.PEDIDO_ENTREGADO]: { titulo: '✅ Tu pedido fue entregado' },
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly stripeService: StripeService,
    private readonly notificacionesQueueService: NotificacionesQueueService,
  ) {}

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

  async exportHistoricoCsv(
    query: ExportOrdersHistoricoQueryDto,
  ): Promise<string> {
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

    const actualizado = await this.tenantPrisma.client.order.update({
      where: { id },
      data: { estadoPedido: siguiente },
      include: {
        items: {
          include: {
            modificadores: { select: { nombreGrupo: true, nombre: true, precioAdicional: true } },
          },
        },
      },
    });

    const evento = EVENTO_POR_ESTADO[siguiente];
    if (evento) {
      // Best-effort a propósito (ver NotificacionesQueueService.encolarSeguro)
      // — nunca debe bloquear ni tumbar el avance del pedido. destinatarioCliente
      // prioriza Order.clienteCorreo (correo general, capturado en el paso
      // "datos" del checkout, independiente de facturación) y cae a
      // Order.facturaCorreo como respaldo — pedidos creados antes de que
      // existiera clienteCorreo, o casos raros donde el cliente solo llenó el
      // correo de facturación. Si ninguno de los dos existe, el worker omite
      // la fila de audiencia CLIENTE con un log claro (ver
      // NotificacionesProcessor), no falla el job por eso.
      //
      // nombreTenant: consulta extra (Tenant.findUnique) no evitable — este
      // service no tenía el nombre del negocio a la mano. Se prefirió sobre
      // NotificacionCanalConfig.nombreRemitente (lo que usa CorreoProvider
      // como remitente real) porque qué canal/config termina usándose se
      // resuelve después, dentro de NotificacionesProcessor — adivinarlo aquí
      // podría no coincidir con el canal real que se dispare.
      const tenant = await this.tenantPrisma.client.tenant.findUnique({
        where: { id: actualizado.tenantId },
        select: { nombre: true },
      });

      void this.notificacionesQueueService.encolarSeguro({
        tenantId: actualizado.tenantId,
        evento,
        mensaje: {
          asunto: `Tu pedido #${actualizado.folio} — actualización`,
          texto: `Tu pedido #${actualizado.folio} cambió de estatus: ${evento}.`,
          html: this.construirCorreoHtmlPedido(tenant?.nombre ?? 'Aelika', actualizado, evento),
        },
        destinatarioCliente: actualizado.clienteCorreo ?? actualizado.facturaCorreo ?? undefined,
      });
    }

    return actualizado;
  }

  /**
   * HTML del correo para los 3 eventos de estatus (audiencia Cliente) —
   * mismo nivel de detalle que PublicService.construirReciboPedidoRecibido
   * (Telegram, "Pedido recibido"), pero reconstruido aquí a propósito: ese
   * método vive donde se crea el pedido, este vive donde se avanza de
   * estatus — datos disponibles y forma del mensaje son distintos (HTML vs
   * texto plano de Telegram), así que no valía la pena forzar un helper
   * compartido para tres líneas de lógica que ya difieren en formato.
   *
   * Estilos inline a propósito — sin librería de plantillas (no hay
   * React Email/MJML en el proyecto, ver CLAUDE.md): es el estándar para
   * correos transaccionales, mejor compatibilidad entre clientes de correo
   * que agregar una dependencia nueva para una sola plantilla.
   */
  private construirCorreoHtmlPedido(
    tenantNombre: string,
    order: Prisma.OrderGetPayload<{
      include: {
        items: {
          include: { modificadores: { select: { nombreGrupo: true; nombre: true; precioAdicional: true } } };
        };
      };
    }>,
    evento: NotificacionEvento,
  ): string {
    const { titulo, subtitulo } = EVENTO_TITULO[evento];

    const filasProductos = order.items
      .map((item) => {
        const extraPorUnidad = item.modificadores.reduce((sum, m) => sum + Number(m.precioAdicional), 0);
        const subtotalLinea = (Number(item.precioUnitario) + extraPorUnidad) * item.cantidad;
        const modificadoresTexto =
          item.modificadores.length > 0
            ? item.modificadores.map((m) => `${m.nombreGrupo}: ${m.nombre}`).join(' · ')
            : 'Sin modificadores';

        return `
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #eeeeee;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:14px;color:#111111;font-weight:600;">
                    ${item.cantidad}x ${item.nombreProducto}
                  </td>
                  <td style="font-size:14px;color:#111111;font-weight:600;text-align:right;white-space:nowrap;">
                    $${subtotalLinea.toFixed(2)}
                  </td>
                </tr>
              </table>
              <div style="font-size:12px;color:#888888;margin-top:2px;">${modificadoresTexto}</div>
            </td>
          </tr>`;
      })
      .join('');

    const filaDescuento =
      Number(order.descuentoTotal) > 0
        ? `<tr>
             <td style="padding:6px 0;font-size:14px;color:#c0392b;text-align:right;" colspan="2">
               Descuento: -$${Number(order.descuentoTotal).toFixed(2)}
             </td>
           </tr>`
        : '';

    return `
<div style="max-width:520px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;background:#ffffff;">
  <div style="background:#111111;padding:20px 24px;">
    <span style="color:#ffffff;font-size:16px;font-weight:700;">${tenantNombre}</span>
  </div>

  <div style="padding:24px;">
    <p style="font-size:20px;font-weight:700;color:#111111;margin:0 0 4px;">${titulo}</p>
    ${subtitulo ? `<p style="font-size:14px;color:#666666;margin:0 0 16px;">${subtitulo}</p>` : ''}

    <p style="font-size:13px;color:#666666;margin:16px 0;">
      Pedido #${order.folio} · ${order.clienteNombre} · ${order.clienteTelefono}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eeeeee;">
      ${filasProductos}
      ${filaDescuento}
      <tr>
        <td style="padding:14px 0 4px;font-size:16px;font-weight:700;color:#111111;text-align:right;" colspan="2">
          TOTAL: $${Number(order.total).toFixed(2)} MXN
        </td>
      </tr>
    </table>

    <div style="background:#f5f5f5;border-radius:6px;padding:10px 14px;margin-top:20px;font-size:13px;color:#555555;">
      Recibido: ${this.formatearFechaRecibo(order.createdAt)}
    </div>
  </div>

  <div style="padding:16px 24px;border-top:1px solid #eeeeee;">
    <span style="font-size:11px;color:#aaaaaa;">Enviado con Aelika</span>
  </div>
</div>`;
  }

  // DD/MM/YYYY HH:mm en la zona horaria de los pilotos — mismo criterio que
  // PublicService.formatearFechaRecibo (ver CLAUDE.md), duplicado aquí en
  // vez de extraído a un helper compartido: cada service tiene su propia
  // copia mínima, mismo patrón ya establecido por ese método.
  private formatearFechaRecibo(fecha: Date): string {
    const formatter = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const partes = formatter.formatToParts(fecha);
    const get = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
    return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
  }

  /**
   * POST /:id/reembolsar. v1 scope: full refund only, no partial — no
   * `amount` passed to Stripe. Synchronous confirmation straight from the
   * refund creation response; no new webhook event is handled for this (see
   * CLAUDE.md's Stripe Connect section — same "server always recomputes,
   * never trusts the client" spirit, just applied to Stripe's response
   * instead of a client body). Ownership is enforced the same way as
   * avanzar() — tenantPrisma.client.order.findUnique already scopes to the
   * session's tenantId, so a foreign order 404s instead of leaking a 403.
   */
  async reembolsar(id: string) {
    const order = await this.tenantPrisma.client.order.findUnique({
      where: { id },
    });
    if (!order) {
      throw new NotFoundException('Pedido no encontrado');
    }

    if (
      order.metodoPago !== MetodoPago.TARJETA ||
      order.estadoPago !== EstadoPago.PAGADO
    ) {
      throw new ConflictException(
        'Solo se pueden reembolsar pedidos pagados con tarjeta y en estado Pagado',
      );
    }

    try {
      const refund = await this.stripeService.client.refunds.create({
        payment_intent: order.stripePaymentIntentId!,
        reverse_transfer: true,
      });

      return this.tenantPrisma.client.order.update({
        where: { id },
        data: { estadoPago: EstadoPago.REEMBOLSADO, stripeRefundId: refund.id },
        include: { items: true },
      });
    } catch (error) {
      // balance_insufficient: the connected account's Stripe balance can't
      // cover reverse_transfer pulling the money back — the one failure mode
      // product explicitly asked to be told apart from any other Stripe
      // error. The order is left untouched (no write happened above).
      if (
        error instanceof Stripe.errors.StripeError &&
        error.code === 'balance_insufficient'
      ) {
        throw new ConflictException(
          'El negocio no tiene saldo suficiente para esta devolución.',
        );
      }
      throw new InternalServerErrorException(
        'No se pudo procesar la devolución. Intenta de nuevo más tarde.',
      );
    }
  }
}
