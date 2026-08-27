import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { round2 } from '../common/money';
import { toCsv } from '../common/csv';
import { PedidoB2bEstado, Prisma } from '../../generated/prisma/client';
import { CreatePedidoB2bDto } from './dto/create-pedido-b2b.dto';
import { UpdatePedidoB2bItemsDto } from './dto/update-pedido-b2b-items.dto';
import { ListPedidosB2bQueryDto } from './dto/list-pedidos-b2b-query.dto';
import { ExportPedidosB2bQueryDto } from './dto/export-pedidos-b2b-query.dto';
import {
  assertLunes,
  calcularSemanaDestino,
  crearItems,
  diasEntreFechasISO,
  fechaMexicoYMD,
  nextFolioPedidoB2b,
  resolverCodigoDescuento,
  resolverItems,
  resolverSemanaYDia,
  sumarDiasISO,
} from './pedidos-b2b-logica';

// Semana en curso = la que ya se está surtiendo/despachando (resolverSemanaYDia
// de "hoy"), nunca calcularSemanaDestino (que siempre da la semana siguiente,
// pensada para pedidos nuevos entrando por el storefront). Mismo criterio de
// "activo" que ya usa findEntregasDia — no despachados, no cancelados.
const ESTADOS_ACTIVOS: PedidoB2bEstado[] = [
  PedidoB2bEstado.PENDIENTE_CONFIRMACION,
  PedidoB2bEstado.CONFIRMADO_SURTIENDO,
];

// Secuencial, sin marcha atrás, independiente de Order/EstadoPedido — ver
// PedidoB2bEstado en schema.prisma. DESPACHADO no tiene siguiente.
const SIGUIENTE_ESTADO: Record<PedidoB2bEstado, PedidoB2bEstado | null> = {
  [PedidoB2bEstado.PENDIENTE_CONFIRMACION]:
    PedidoB2bEstado.CONFIRMADO_SURTIENDO,
  [PedidoB2bEstado.CONFIRMADO_SURTIENDO]: PedidoB2bEstado.DESPACHADO,
  [PedidoB2bEstado.DESPACHADO]: null,
};

// Forma reportable compartida por findAll/exportCsv — deliberadamente similar
// a como se reporta Order hoy (folio, cliente/negocio, fecha, estatus, método
// de pago, total) para no cerrar la puerta a un reporte unificado con Order
// en el futuro, aunque no se construya todavía (ver CLAUDE.md).
const REPORTABLE_SELECT = {
  id: true,
  folio: true,
  negocioNombre: true,
  contactoNombre: true,
  semanaInicio: true,
  estado: true,
  estadoPago: true,
  modoCobro: true,
  cancelado: true,
  totalPiezas: true,
  total: true,
  createdAt: true,
} as const;

@Injectable()
export class PedidosB2bService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  private buildWhere(query: {
    estado?: PedidoB2bEstado;
    estados?: PedidoB2bEstado[];
    cancelado?: boolean;
    desde?: string;
    hasta?: string;
    negocioNombre?: string;
  }): Prisma.PedidoB2bWhereInput {
    return {
      // `estados` (multi-valor) tiene prioridad si llega — ver
      // ExportPedidosB2bQueryDto para el motivo (vista "activos" con dos
      // estatus a la vez, sin pestaña por estatus).
      estado: query.estados ? { in: query.estados } : query.estado,
      cancelado: query.cancelado,
      semanaInicio:
        query.desde || query.hasta
          ? {
              gte: query.desde ? new Date(query.desde) : undefined,
              lte: query.hasta ? new Date(query.hasta) : undefined,
            }
          : undefined,
      // Coincidencia parcial, case-insensitive — usado por "Históricos"
      // (Pedidos activos filtra por negocio en el cliente porque trae todo
      // sin paginar; Históricos pagina de verdad, así que esto tiene que
      // resolverse en la query).
      negocioNombre: query.negocioNombre
        ? { contains: query.negocioNombre, mode: 'insensitive' }
        : undefined,
    };
  }

  async findAll(query: ListPedidosB2bQueryDto) {
    const where = this.buildWhere(query);
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.pedidoB2b.findMany({
        where,
        orderBy: { semanaInicio: 'desc' },
        skip,
        take: query.limit,
        select: REPORTABLE_SELECT,
      }),
      this.tenantPrisma.client.pedidoB2b.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async exportCsv(query: ExportPedidosB2bQueryDto): Promise<string> {
    const where = this.buildWhere(query);

    const pedidos = await this.tenantPrisma.client.pedidoB2b.findMany({
      where,
      orderBy: { semanaInicio: 'desc' },
      select: REPORTABLE_SELECT,
    });

    return toCsv(pedidos, [
      { header: 'Folio', value: (p) => p.folio },
      { header: 'Negocio', value: (p) => p.negocioNombre },
      { header: 'Contacto', value: (p) => p.contactoNombre },
      {
        header: 'Semana',
        value: (p) => p.semanaInicio.toISOString().slice(0, 10),
      },
      { header: 'Estado', value: (p) => p.estado },
      { header: 'Modo de cobro', value: (p) => p.modoCobro },
      { header: 'Estado de pago', value: (p) => p.estadoPago },
      { header: 'Cancelado', value: (p) => (p.cancelado ? 'Sí' : 'No') },
      { header: 'Piezas', value: (p) => p.totalPiezas },
      { header: 'Total', value: (p) => Number(p.total).toFixed(2) },
    ]);
  }

  /**
   * "Pedidos del día" — todos los pedidos activos (no despachados/cancelados)
   * con algo programado para entregarse en `fechaStr`, con `items` ya
   * recortados a solo las cantidades de ese día (nunca el pedido completo).
   * Ver resolverSemanaYDia: la fecha se resuelve a semanaInicio + DiaSemana,
   * PedidoB2bItemDia no guarda una fecha real.
   */
  async findEntregasDia(fechaStr: string) {
    const { semanaInicio, dia } = resolverSemanaYDia(fechaStr);

    const pedidos = await this.tenantPrisma.client.pedidoB2b.findMany({
      where: {
        semanaInicio,
        cancelado: false,
        estado: {
          in: [
            PedidoB2bEstado.PENDIENTE_CONFIRMACION,
            PedidoB2bEstado.CONFIRMADO_SURTIENDO,
          ],
        },
      },
      orderBy: { negocioNombre: 'asc' },
      select: {
        id: true,
        folio: true,
        negocioNombre: true,
        contactoNombre: true,
        contactoTelefono: true,
        estado: true,
        items: {
          select: {
            productId: true,
            nombreProducto: true,
            precioUnitario: true,
            // Filtrado a un solo día — @@unique([pedidoB2bItemId, dia]),
            // así que esto trae a lo más una fila por item.
            distribucion: { where: { dia }, select: { cantidad: true } },
          },
        },
      },
    });

    return pedidos
      .map((pedido) => ({
        ...pedido,
        items: pedido.items
          .filter((item) => item.distribucion[0]?.cantidad > 0)
          .map((item) => ({
            productId: item.productId,
            nombreProducto: item.nombreProducto,
            precioUnitario: item.precioUnitario,
            cantidad: item.distribucion[0].cantidad,
          })),
      }))
      .filter((pedido) => pedido.items.length > 0);
  }

  async exportEntregasDiaCsv(fechaStr: string): Promise<string> {
    const entregas = await this.findEntregasDia(fechaStr);

    const filas = entregas.flatMap((pedido) =>
      pedido.items.map((item) => ({
        folio: pedido.folio,
        negocioNombre: pedido.negocioNombre,
        contactoNombre: pedido.contactoNombre,
        contactoTelefono: pedido.contactoTelefono,
        nombreProducto: item.nombreProducto,
        cantidad: item.cantidad,
      })),
    );

    return toCsv(filas, [
      { header: 'Folio', value: (f) => f.folio },
      { header: 'Negocio', value: (f) => f.negocioNombre },
      { header: 'Contacto', value: (f) => f.contactoNombre },
      { header: 'Teléfono', value: (f) => f.contactoTelefono },
      { header: 'Producto', value: (f) => f.nombreProducto },
      { header: 'Cantidad', value: (f) => f.cantidad },
    ]);
  }

  /**
   * Agregado para el módulo Inicio del panel cuando el tenant es RETAIL_B2B —
   * mismo patrón que OrdersService.summary (B2C): un solo método que junta
   * varias fuentes en un objeto de respuesta, acoplado directo a este
   * service (sin capa de "reports" separada). "Semana en curso" es la que ya
   * se está surtiendo (resolverSemanaYDia(hoy)); "próxima semana" es la que
   * calcularSemanaDestino calcula para pedidos entrando ahora mismo por la
   * ventana de recepción del storefront — son conceptos distintos, nunca la
   * misma semana salvo que hoy sea domingo.
   */
  async resumen() {
    const hoy = fechaMexicoYMD();
    const manana = sumarDiasISO(hoy, 1);

    const { semanaInicio: semanaEnCursoInicio } = resolverSemanaYDia(hoy);
    const semanaEnCursoFin = new Date(semanaEnCursoInicio);
    semanaEnCursoFin.setUTCDate(semanaEnCursoInicio.getUTCDate() + 6);

    const semanaSiguiente = calcularSemanaDestino();
    const semanaSiguienteInicio = new Date(
      `${semanaSiguiente.inicio}T00:00:00.000Z`,
    );

    const [
      pendientesConfirmacion,
      confirmadosSurtiendo,
      piezasActivasAgg,
      entregasHoy,
      entregasManana,
      pendientesMasAntiguosRaw,
      proximaSemanaAgg,
      rankingProductosRaw,
    ] = await Promise.all([
      this.tenantPrisma.client.pedidoB2b.count({
        where: {
          semanaInicio: semanaEnCursoInicio,
          cancelado: false,
          estado: PedidoB2bEstado.PENDIENTE_CONFIRMACION,
        },
      }),
      this.tenantPrisma.client.pedidoB2b.count({
        where: {
          semanaInicio: semanaEnCursoInicio,
          cancelado: false,
          estado: PedidoB2bEstado.CONFIRMADO_SURTIENDO,
        },
      }),
      this.tenantPrisma.client.pedidoB2b.aggregate({
        where: {
          semanaInicio: semanaEnCursoInicio,
          cancelado: false,
          estado: { in: ESTADOS_ACTIVOS },
        },
        _sum: { totalPiezas: true },
      }),
      this.entregasResumenDia(hoy),
      this.entregasResumenDia(manana),
      this.tenantPrisma.client.pedidoB2b.findMany({
        where: {
          cancelado: false,
          estado: PedidoB2bEstado.PENDIENTE_CONFIRMACION,
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
        select: { id: true, folio: true, negocioNombre: true, createdAt: true },
      }),
      this.tenantPrisma.client.pedidoB2b.aggregate({
        where: { semanaInicio: semanaSiguienteInicio, cancelado: false },
        _count: true,
        _sum: { totalPiezas: true },
      }),
      // Ranking de productos: semana en curso + próxima semana juntas, solo
      // excluyendo cancelados (no se filtra por estado — a diferencia de los
      // conteos de arriba, esto mide demanda, no pipeline de confirmación).
      this.tenantPrisma.client.pedidoB2bItem.groupBy({
        by: ['nombreProducto'],
        where: {
          pedidoB2b: {
            semanaInicio: { in: [semanaEnCursoInicio, semanaSiguienteInicio] },
            cancelado: false,
          },
        },
        _sum: { cantidadTotal: true },
        orderBy: { _sum: { cantidadTotal: 'desc' } },
        take: 6,
      }),
    ]);

    return {
      semanaEnCurso: {
        inicio: semanaEnCursoInicio.toISOString().slice(0, 10),
        fin: semanaEnCursoFin.toISOString().slice(0, 10),
        pendientesConfirmacion,
        confirmadosSurtiendo,
        totalPiezas: piezasActivasAgg._sum.totalPiezas ?? 0,
        entregasHoy,
        entregasManana,
        pendientesMasAntiguos: pendientesMasAntiguosRaw.map((p) => ({
          id: p.id,
          folio: p.folio,
          negocioNombre: p.negocioNombre,
          diasPendiente: diasEntreFechasISO(fechaMexicoYMD(p.createdAt), hoy),
        })),
      },
      proximaSemana: {
        inicio: semanaSiguiente.inicio,
        fin: semanaSiguiente.fin,
        totalPedidos: proximaSemanaAgg._count,
        totalPiezas: proximaSemanaAgg._sum.totalPiezas ?? 0,
      },
      rankingProductos: rankingProductosRaw.map((r) => ({
        nombreProducto: r.nombreProducto,
        cantidadTotal: r._sum.cantidadTotal ?? 0,
      })),
    };
  }

  /**
   * Entregas de un día — mismo filtro "activo" y misma resolución de
   * semana/día que findEntregasDia, pero una proyección más ligera (sin
   * productId/nombreProducto/precioUnitario/contactoTelefono) y agregada por
   * pedido (cantidad ya sumada entre todos sus productos de ese día) en vez
   * de desglosada por item — pensada para el widget de Inicio, no para
   * imprimir/exportar.
   */
  private async entregasResumenDia(fechaStr: string) {
    const { semanaInicio, dia } = resolverSemanaYDia(fechaStr);

    const pedidos = await this.tenantPrisma.client.pedidoB2b.findMany({
      where: {
        semanaInicio,
        cancelado: false,
        estado: { in: ESTADOS_ACTIVOS },
      },
      select: {
        folio: true,
        negocioNombre: true,
        items: {
          select: {
            distribucion: { where: { dia }, select: { cantidad: true } },
          },
        },
      },
    });

    return pedidos
      .map((pedido) => ({
        folio: pedido.folio,
        negocioNombre: pedido.negocioNombre,
        cantidad: pedido.items.reduce(
          (suma, item) => suma + (item.distribucion[0]?.cantidad ?? 0),
          0,
        ),
      }))
      .filter((entrega) => entrega.cantidad > 0);
  }

  async findOne(id: string) {
    const pedido = await this.tenantPrisma.client.pedidoB2b.findUnique({
      where: { id },
      include: {
        items: { include: { distribucion: true } },
        codigoDescuento: true,
      },
    });
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }
    return pedido;
  }

  async create(tenantId: string, dto: CreatePedidoB2bDto) {
    // Tenant no está registrado en TenantPrismaService (es la raíz, no un
    // modelo tenant-owned) — se lee directo con PrismaService, mismo patrón
    // que TenantService.
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { pedidoB2bModoCobro: true, pedidoB2bMinimoPiezas: true },
    });

    const semanaInicio = assertLunes(dto.semanaInicio);
    const { resueltos, totalPiezas, subtotal } = await resolverItems(
      this.tenantPrisma.client,
      tenantId,
      dto.items,
    );
    const {
      codigoDescuentoId,
      codigoDescuentoTexto,
      descuentoPorcentajeAplicado,
      descuentoTotal,
    } = await resolverCodigoDescuento(
      this.tenantPrisma.client,
      tenantId,
      dto.codigoDescuento,
      subtotal,
    );

    const total = round2(subtotal - descuentoTotal);

    return this.tenantPrisma.client.$transaction(async (tx) => {
      const folio = await nextFolioPedidoB2b(tx, tenantId);

      const pedido = await tx.pedidoB2b.create({
        // tenantId es requerido por los tipos generados pero se inyecta en
        // tiempo de ejecución por la extensión tenant-scoped (ver
        // TenantPrismaService) — igual que el resto de los servicios.
        data: {
          folio,
          negocioNombre: dto.negocioNombre,
          contactoNombre: dto.contactoNombre,
          contactoTelefono: dto.contactoTelefono,
          contactoCorreo: dto.contactoCorreo,
          semanaInicio,
          modoCobro: tenant.pedidoB2bModoCobro,
          minimoPiezasAplicado: tenant.pedidoB2bMinimoPiezas,
          totalPiezas,
          codigoDescuentoId,
          codigoDescuentoTexto,
          descuentoPorcentajeAplicado,
          subtotal,
          descuentoTotal,
          total,
        } as any,
      });

      await crearItems(tx, tenantId, pedido.id, resueltos);

      return tx.pedidoB2b.findUniqueOrThrow({
        where: { id: pedido.id },
        include: { items: { include: { distribucion: true } } },
      });
    });
  }

  /**
   * Reemplazo completo de items/distribución sobre un pedido existente — ver
   * UpdatePedidoB2bItemsDto. El código/porcentaje de descuento no es
   * editable aquí (no forma parte del alcance de edición descrito), solo se
   * reaplica sobre el nuevo subtotal.
   */
  async updateItems(id: string, dto: UpdatePedidoB2bItemsDto) {
    const pedido = await this.tenantPrisma.client.pedidoB2b.findUnique({
      where: { id },
    });
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }
    this.assertActivo(pedido);
    if (pedido.estado === PedidoB2bEstado.DESPACHADO) {
      throw new ConflictException('No puedes editar un pedido ya despachado');
    }
    // Si el pedido ya está pagado (modo AL_INICIO), no se edita el mismo
    // pedido — se crea uno nuevo e independiente. Ver CLAUDE.md.
    if (pedido.estadoPago === 'PAGADO') {
      throw new ConflictException(
        'Este pedido ya está pagado — crea un pedido nuevo para agregar más producto',
      );
    }

    const { resueltos, totalPiezas, subtotal } = await resolverItems(
      this.tenantPrisma.client,
      pedido.tenantId,
      dto.items,
    );
    const descuentoPorcentaje = pedido.descuentoPorcentajeAplicado
      ? Number(pedido.descuentoPorcentajeAplicado)
      : 0;
    const descuentoTotal = round2(subtotal * (descuentoPorcentaje / 100));
    const total = round2(subtotal - descuentoTotal);

    return this.tenantPrisma.client.$transaction(async (tx) => {
      await tx.pedidoB2bItem.deleteMany({ where: { pedidoB2bId: id } });
      await crearItems(tx, pedido.tenantId, id, resueltos);

      return tx.pedidoB2b.update({
        where: { id },
        data: { totalPiezas, subtotal, descuentoTotal, total },
        include: { items: { include: { distribucion: true } } },
      });
    });
  }

  /**
   * PATCH /:id/avanzar — calcula el siguiente estado server-side, nunca
   * acepta uno explícito del cliente (mismo principio que
   * OrdersService.avanzar). Al salir de PENDIENTE_CONFIRMACION aplica las
   * reglas de mínimo de piezas / modo de cobro descritas en CLAUDE.md.
   */
  async avanzar(id: string) {
    const pedido = await this.tenantPrisma.client.pedidoB2b.findUnique({
      where: { id },
    });
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }
    this.assertActivo(pedido);

    const siguiente = SIGUIENTE_ESTADO[pedido.estado];
    if (!siguiente) {
      throw new ConflictException('Este pedido ya está despachado');
    }

    if (pedido.estado === PedidoB2bEstado.PENDIENTE_CONFIRMACION) {
      if (pedido.modoCobro === 'AL_INICIO') {
        throw new ConflictException(
          'Este pedido requiere pago para confirmarse — usa /pedidos-b2b/:id/marcar-pagado',
        );
      }
      // AL_FINAL: el mínimo de piezas bloquea la confirmación, y solo aquí —
      // una vez confirmado nunca se vuelve a revalidar (ver updateItems).
      if (pedido.totalPiezas < pedido.minimoPiezasAplicado) {
        throw new ConflictException(
          `Este pedido no alcanza el mínimo de ${pedido.minimoPiezasAplicado} piezas (tiene ${pedido.totalPiezas})`,
        );
      }
    }

    return this.tenantPrisma.client.pedidoB2b.update({
      where: { id },
      data: { estado: siguiente },
      include: { items: { include: { distribucion: true } } },
    });
  }

  /**
   * PATCH /:id/marcar-pagado. En modo AL_INICIO esta es la acción de
   * "pago/checkout" descrita en CLAUDE.md: el mínimo de piezas se valida
   * aquí (no en /avanzar, que la rechaza directamente para este modo) y,
   * al pagar, el pedido se confirma en el mismo paso (pago con tarjeta al
   * confirmar el pedido). En modo AL_FINAL es la confirmación de pago manual
   * — no reabre ni revalida el mínimo, y no mueve `estado`.
   */
  async marcarPagado(id: string) {
    const pedido = await this.tenantPrisma.client.pedidoB2b.findUnique({
      where: { id },
    });
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }
    this.assertActivo(pedido);

    if (pedido.estadoPago === 'PAGADO') {
      throw new ConflictException('Este pedido ya está pagado');
    }

    const data: Prisma.PedidoB2bUpdateInput = { estadoPago: 'PAGADO' };

    if (pedido.modoCobro === 'AL_INICIO') {
      if (pedido.estado !== PedidoB2bEstado.PENDIENTE_CONFIRMACION) {
        throw new ConflictException('Este pedido ya fue confirmado');
      }
      if (pedido.totalPiezas < pedido.minimoPiezasAplicado) {
        throw new ConflictException(
          `Este pedido no alcanza el mínimo de ${pedido.minimoPiezasAplicado} piezas para procesar el pago (tiene ${pedido.totalPiezas})`,
        );
      }
      data.estado = PedidoB2bEstado.CONFIRMADO_SURTIENDO;
    }

    return this.tenantPrisma.client.pedidoB2b.update({
      where: { id },
      data,
      include: { items: { include: { distribucion: true } } },
    });
  }

  /**
   * PATCH /:id/cancelar. Cancelación es un flag ortogonal a `estado` (ver
   * schema.prisma) — no hay ninguna regla de anticipación que el sistema
   * valide, es una decisión operativa manual, solo bloqueada una vez
   * DESPACHADO.
   */
  async cancelar(id: string) {
    const pedido = await this.tenantPrisma.client.pedidoB2b.findUnique({
      where: { id },
    });
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado');
    }
    if (pedido.cancelado) {
      throw new ConflictException('Este pedido ya está cancelado');
    }
    if (pedido.estado === PedidoB2bEstado.DESPACHADO) {
      throw new ConflictException('No puedes cancelar un pedido ya despachado');
    }

    return this.tenantPrisma.client.pedidoB2b.update({
      where: { id },
      data: { cancelado: true, canceladoAt: new Date() },
      include: { items: { include: { distribucion: true } } },
    });
  }

  private assertActivo(pedido: { cancelado: boolean }) {
    if (pedido.cancelado) {
      throw new ConflictException('Este pedido está cancelado');
    }
  }
}
