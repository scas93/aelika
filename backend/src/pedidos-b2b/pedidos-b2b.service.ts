import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { round2 } from '../common/money';
import { toCsv } from '../common/csv';
import { fechaExcel } from '../common/xlsx';
import {
  libroEntregasDia,
  libroPedidos,
  type FilaEntregaExcel,
  type FilaPedidoExcel,
} from './pedidos-b2b-excel';
import {
  ClienteCanal,
  EstadoEntrega,
  EstadoPago,
  EstadoPedido,
  PedidoB2bEstado,
  Prisma,
  Role,
  TipoOrden,
} from '../../generated/prisma/client';
import { recalcularContadoresCliente } from '../clientes/cliente-contadores';
import { ClientesService } from '../clientes/clientes.service';
import { ReglaEventoPedidoService } from '../notificaciones-reglas/regla-evento-pedido.service';
import { PedidoContexto } from '../notificaciones-reglas/plantilla-variable.type';
import { CreatePedidoB2bDto } from './dto/create-pedido-b2b.dto';
import { UpdatePedidoB2bItemsDto } from './dto/update-pedido-b2b-items.dto';
import { ListPedidosB2bQueryDto } from './dto/list-pedidos-b2b-query.dto';
import { CerrarEntregaB2bDto } from './dto/cerrar-entrega-b2b.dto';
import { CorregirEntregaB2bDto } from './dto/corregir-entrega-b2b.dto';
import { ExportPedidosB2bQueryDto } from './dto/export-pedidos-b2b-query.dto';
import {
  FiltroImporteOperador,
  filtroImporteWhere,
} from '../common/filtro-importe';
import {
  assertLunes,
  calcularSemanaDestino,
  diasEntreFechasISO,
  fechaMexicoYMD,
  nextFolioPedidoB2b,
  resolverItems,
  resolverSemanaYDia,
  sumarDiasISO,
} from './pedidos-b2b-logica';
import {
  aRespuestaPedidoB2b,
  crearOrdenB2b,
  fechaDeDia,
  INCLUDE_PEDIDO,
  INCLUDE_PEDIDO_ADMIN,
  sincronizarOrdenB2b,
} from './pedidos-b2b-orden';
import {
  entregaAtrasada,
  ESTADOS_B2B_ACTIVOS,
  ESTADOS_B2B_COMPLETADOS,
  estadoB2bVisible,
  ESTADOS_ENTREGA_CERRADOS,
  estadosDeBdParaFiltro,
  puedeEditarPedidoPagado,
  recalcularEstadoB2b,
  recalcularTotalesB2b,
  type EstadoB2bFiltro,
  type EstadoPagoB2bFiltro,
} from './pedidos-b2b-estados';

// Etapa 2: un pedido B2B ES una Order (tipo B2B) + DetalleB2B + OrderItem + Entrega/EntregaItem. Este servicio conserva
// las rutas, reglas y la forma de las respuestas de siempre; el mapeo a la forma plana de PedidoB2b vive en
// aRespuestaPedidoB2b (pedidos-b2b-orden.ts).

// "Activo" = Por confirmar, Confirmado o En proceso (y no cancelado). Completado y Cancelado viven en Históricos.
// (Semana en curso = la que ya se está surtiendo — resolverSemanaYDia de "hoy", nunca calcularSemanaDestino.)
const ESTADOS_ACTIVOS: EstadoPedido[] = ESTADOS_B2B_ACTIVOS;

// Forma reportable compartida por findAll/exportCsv — deliberadamente similar
// a como se reporta Order hoy (folio, cliente/negocio, fecha, estatus, método
// de pago, total) para no cerrar la puerta a un reporte unificado con Order
// en el futuro, aunque no se construya todavía (ver CLAUDE.md).
const REPORTABLE_SELECT = {
  id: true,
  folio: true,
  clienteNombre: true,
  estadoPedido: true,
  estadoPago: true,
  cancelado: true,
  total: true,
  createdAt: true,
  detalleB2b: {
    select: {
      negocioNombre: true,
      semanaInicio: true,
      modoCobro: true,
      totalPiezas: true,
    },
  },
} satisfies Prisma.OrderSelect;

function aReportable(
  o: Prisma.OrderGetPayload<{ select: typeof REPORTABLE_SELECT }>,
) {
  const d = o.detalleB2b!;
  return {
    id: o.id,
    folio: o.folio,
    negocioNombre: d.negocioNombre,
    contactoNombre: o.clienteNombre,
    semanaInicio: d.semanaInicio,
    estado: estadoB2bVisible(o.estadoPedido),
    estadoPago: o.estadoPago,
    modoCobro: d.modoCobro,
    cancelado: o.cancelado,
    totalPiezas: d.totalPiezas,
    total: o.total,
    createdAt: o.createdAt,
  };
}

@Injectable()
export class PedidosB2bService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly clientesService: ClientesService,
    private readonly reglaEventoPedidoService: ReglaEventoPedidoService,
  ) {}

  private buildWhere(query: {
    estado?: EstadoB2bFiltro;
    estados?: EstadoB2bFiltro[];
    estadoPago?: EstadoPagoB2bFiltro;
    soloHistorico?: boolean;
    semanaAntesDe?: string;
    cancelado?: boolean;
    desde?: string;
    hasta?: string;
    negocioNombre?: string;
    operador?: FiltroImporteOperador;
    valor?: number;
    valorHasta?: number;
  }): Prisma.OrderWhereInput {
    const detalle: Prisma.DetalleB2BWhereInput = {
      semanaInicio:
        query.desde || query.hasta || query.semanaAntesDe
          ? {
              gte: query.desde ? new Date(query.desde) : undefined,
              lte: query.hasta ? new Date(query.hasta) : undefined,
              // semanaInicio estrictamente anterior (pedidos activos de semanas pasadas)
              lt: query.semanaAntesDe
                ? new Date(query.semanaAntesDe)
                : undefined,
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
    return {
      tipo: TipoOrden.B2B,
      // `estados` (multi-valor) tiene prioridad si llega — ver
      // ExportPedidosB2bQueryDto para el motivo (vista "activos" con dos
      // estatus a la vez, sin pestaña por estatus).
      // COMPLETADO también abarca el DESPACHADO heredado (antes de migrar los datos).
      estadoPedido: query.estados
        ? { in: [...new Set(query.estados.flatMap(estadosDeBdParaFiltro))] }
        : query.estado
          ? { in: estadosDeBdParaFiltro(query.estado) }
          : undefined,
      cancelado: query.cancelado,
      estadoPago: query.estadoPago ? query.estadoPago : undefined,
      // Históricos: solo Completados (incluye el DESPACHADO heredado) y Cancelados.
      ...(query.soloHistorico
        ? {
            AND: [
              {
                OR: [
                  { cancelado: true },
                  { estadoPedido: { in: ESTADOS_B2B_COMPLETADOS } },
                ],
              },
            ],
          }
        : {}),
      total: filtroImporteWhere(query.operador, query.valor, query.valorHasta),
      // Siempre hay detalle en una orden B2B; el filtro solo se agrega si realmente se filtra por él.
      ...(detalle.semanaInicio || detalle.negocioNombre
        ? { detalleB2b: detalle }
        : {}),
    };
  }

  async findAll(query: ListPedidosB2bQueryDto) {
    const where = this.buildWhere(query);
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.order.findMany({
        where,
        orderBy: { detalleB2b: { semanaInicio: 'desc' } },
        skip,
        take: query.limit,
        select: REPORTABLE_SELECT,
      }),
      this.tenantPrisma.client.order.count({ where }),
    ]);

    return {
      data: data.map(aReportable),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async exportCsv(query: ExportPedidosB2bQueryDto): Promise<string> {
    const where = this.buildWhere(query);

    const pedidos = (
      await this.tenantPrisma.client.order.findMany({
        where,
        orderBy: { detalleB2b: { semanaInicio: 'desc' } },
        select: REPORTABLE_SELECT,
      })
    ).map(aReportable);

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
   * Excel (.xlsx) de Históricos y Pedidos activos: una fila por pedido, con los mismos filtros que el CSV. Subtotal, descuento
   * % y descuento $ salen tal como están guardados en el pedido (sin recalcular, también en pedidos cancelados).
   */
  async exportPedidosXlsx(query: ExportPedidosB2bQueryDto): Promise<Buffer> {
    const pedidos = await this.tenantPrisma.client.order.findMany({
      where: this.buildWhere(query),
      orderBy: [{ detalleB2b: { semanaInicio: 'desc' } }, { createdAt: 'asc' }],
      select: {
        folio: true,
        estadoPedido: true,
        estadoPago: true,
        cancelado: true,
        total: true,
        descuentoTotal: true,
        createdAt: true,
        detalleB2b: {
          select: {
            negocioNombre: true,
            semanaInicio: true,
            subtotal: true,
            descuentoPorcentajeAplicado: true,
            pagadoAt: true,
          },
        },
        entregas: { select: { estado: true } },
      },
    });
    const filas: FilaPedidoExcel[] = pedidos.map((o) => ({
      folio: o.folio,
      negocioNombre: o.detalleB2b!.negocioNombre,
      semanaInicio: o.detalleB2b!.semanaInicio,
      createdAt: o.createdAt,
      estado: estadoB2bVisible(o.estadoPedido),
      cancelado: o.cancelado,
      estadoPago: o.estadoPago,
      pagadoAt: o.detalleB2b!.pagadoAt,
      estadosEntregas: o.entregas.map((e) => e.estado),
      subtotal: Number(o.detalleB2b!.subtotal),
      descuentoPorcentaje: Number(
        o.detalleB2b!.descuentoPorcentajeAplicado ?? 0,
      ),
      descuentoTotal: Number(o.descuentoTotal),
      total: Number(o.total),
    }));
    return libroPedidos(filas);
  }

  /** Excel (.xlsx) de Entregas del día: hojas Entregas (una fila por producto de cada entrega, sin canceladas) y Consolidado. */
  async exportEntregasDiaXlsx(fechaStr: string): Promise<Buffer> {
    const { semanaInicio, dia } = resolverSemanaYDia(fechaStr);
    const fecha = fechaDeDia(semanaInicio, dia);
    const vigente = { fecha, estado: { not: EstadoEntrega.CANCELADA } };

    const pedidos = await this.tenantPrisma.client.order.findMany({
      where: { tipo: TipoOrden.B2B, entregas: { some: vigente } },
      orderBy: [{ detalleB2b: { negocioNombre: 'asc' } }, { createdAt: 'asc' }],
      select: {
        folio: true,
        detalleB2b: { select: { negocioNombre: true } },
        entregas: { where: vigente, select: { estado: true } },
        items: {
          orderBy: [{ orden: 'asc' }, { id: 'asc' }],
          select: {
            nombreProducto: true,
            precioUnitario: true,
            product: { select: { category: { select: { nombre: true } } } },
            entregaItems: {
              where: { entrega: vigente },
              select: { cantidad: true },
            },
          },
        },
      },
    });

    const filas: FilaEntregaExcel[] = pedidos.flatMap((pedido) =>
      pedido.items
        .map((item) => ({
          fecha: fechaExcel(fecha),
          folio: pedido.folio,
          negocioNombre: pedido.detalleB2b!.negocioNombre,
          estadoEntrega: pedido.entregas[0].estado,
          categoria: item.product?.category?.nombre ?? 'Sin categoría',
          producto: item.nombreProducto,
          cantidad: item.entregaItems.reduce(
            (suma, ei) => suma + ei.cantidad,
            0,
          ),
          precioUnitario: Number(item.precioUnitario),
        }))
        .filter((fila) => fila.cantidad > 0),
    );
    return libroEntregasDia(filas);
  }

  /**
   * Entregas de un día: una fila por pedido con algo para `fechaStr`, con su entrega (id, estado, atrasada) e `items`
   * recortados a las cantidades de ese día (nunca el pedido completo). Las entregas CANCELADAS no aparecen; las cerradas
   * (Entregada / No recogida) sí, con su estado. La fecha es la de una Entrega real.
   */
  async findEntregasDia(fechaStr: string) {
    const { semanaInicio, dia } = resolverSemanaYDia(fechaStr);
    const fecha = fechaDeDia(semanaInicio, dia);
    const vigente = { fecha, estado: { not: EstadoEntrega.CANCELADA } };

    const pedidos = await this.tenantPrisma.client.order.findMany({
      where: { tipo: TipoOrden.B2B, entregas: { some: vigente } },
      orderBy: { detalleB2b: { negocioNombre: 'asc' } },
      select: {
        id: true,
        folio: true,
        clienteNombre: true,
        clienteTelefono: true,
        estadoPedido: true,
        cancelado: true,
        detalleB2b: { select: { negocioNombre: true } },
        entregas: {
          where: vigente,
          select: {
            id: true,
            estado: true,
            fecha: true,
            estadoCambiadoAt: true,
          },
        },
        items: {
          orderBy: [{ orden: 'asc' }, { id: 'asc' }],
          select: {
            productId: true,
            nombreProducto: true,
            precioUnitario: true,
            // Solo las cantidades de esa fecha (a lo más una fila por ítem: regla B2B de una entrega por fecha).
            entregaItems: {
              where: { entrega: vigente },
              select: { cantidad: true },
            },
          },
        },
      },
    });

    return pedidos
      .map((pedido) => {
        const entrega = pedido.entregas[0];
        return {
          id: pedido.id,
          folio: pedido.folio,
          negocioNombre: pedido.detalleB2b!.negocioNombre,
          contactoNombre: pedido.clienteNombre,
          contactoTelefono: pedido.clienteTelefono,
          estado: estadoB2bVisible(pedido.estadoPedido),
          cancelado: pedido.cancelado,
          entregaId: entrega.id,
          entregaEstado: entrega.estado,
          cerradaAt: entrega.estadoCambiadoAt,
          atrasada: entregaAtrasada(entrega.estado, entrega.fecha),
          items: pedido.items
            .map((item) => ({
              productId: item.productId,
              nombreProducto: item.nombreProducto,
              precioUnitario: item.precioUnitario,
              cantidad: item.entregaItems.reduce(
                (suma, ei) => suma + ei.cantidad,
                0,
              ),
            }))
            .filter((item) => item.cantidad > 0),
        };
      })
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

    const b2bSemanaEnCurso = (
      estados: EstadoPedido[],
    ): Prisma.OrderWhereInput => ({
      tipo: TipoOrden.B2B,
      cancelado: false,
      estadoPedido: { in: estados },
      detalleB2b: { semanaInicio: semanaEnCursoInicio },
    });

    const [
      pendientesConfirmacion,
      confirmadosSurtiendo,
      enProceso,
      piezasActivasAgg,
      entregasHoy,
      entregasManana,
      pendientesMasAntiguosRaw,
      proximaSemanaAgg,
      rankingProductosRaw,
    ] = await Promise.all([
      this.tenantPrisma.client.order.count({
        where: b2bSemanaEnCurso([EstadoPedido.PENDIENTE_CONFIRMACION]),
      }),
      this.tenantPrisma.client.order.count({
        where: b2bSemanaEnCurso([EstadoPedido.CONFIRMADO_SURTIENDO]),
      }),
      this.tenantPrisma.client.order.count({
        where: b2bSemanaEnCurso([EstadoPedido.EN_PROCESO]),
      }),
      this.tenantPrisma.client.detalleB2B.aggregate({
        where: {
          semanaInicio: semanaEnCursoInicio,
          order: b2bSemanaEnCurso(ESTADOS_ACTIVOS),
        },
        _sum: { totalPiezas: true },
      }),
      this.entregasResumenDia(hoy),
      this.entregasResumenDia(manana),
      this.tenantPrisma.client.order.findMany({
        where: {
          tipo: TipoOrden.B2B,
          cancelado: false,
          estadoPedido: EstadoPedido.PENDIENTE_CONFIRMACION,
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
        select: {
          id: true,
          folio: true,
          createdAt: true,
          detalleB2b: { select: { negocioNombre: true } },
        },
      }),
      this.tenantPrisma.client.detalleB2B.aggregate({
        where: {
          semanaInicio: semanaSiguienteInicio,
          order: { tipo: TipoOrden.B2B, cancelado: false },
        },
        _count: true,
        _sum: { totalPiezas: true },
      }),
      // Ranking de productos: semana en curso + próxima semana juntas, solo
      // excluyendo cancelados (no se filtra por estado — a diferencia de los
      // conteos de arriba, esto mide demanda, no pipeline de confirmación).
      this.tenantPrisma.client.orderItem.groupBy({
        by: ['nombreProducto'],
        where: {
          order: {
            tipo: TipoOrden.B2B,
            cancelado: false,
            detalleB2b: {
              semanaInicio: {
                in: [semanaEnCursoInicio, semanaSiguienteInicio],
              },
            },
          },
        },
        _sum: { cantidad: true },
        orderBy: { _sum: { cantidad: 'desc' } },
        take: 6,
      }),
    ]);

    return {
      semanaEnCurso: {
        inicio: semanaEnCursoInicio.toISOString().slice(0, 10),
        fin: semanaEnCursoFin.toISOString().slice(0, 10),
        pendientesConfirmacion,
        confirmadosSurtiendo,
        enProceso,
        totalPiezas: piezasActivasAgg._sum.totalPiezas ?? 0,
        entregasHoy,
        entregasManana,
        pendientesMasAntiguos: pendientesMasAntiguosRaw.map((p) => ({
          id: p.id,
          folio: p.folio,
          negocioNombre: p.detalleB2b!.negocioNombre,
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
        cantidadTotal: r._sum.cantidad ?? 0,
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
    const fecha = fechaDeDia(semanaInicio, dia);

    const pedidos = await this.tenantPrisma.client.order.findMany({
      // Sin entregas Canceladas; las cerradas de hoy siguen contando como entregas del día.
      where: {
        tipo: TipoOrden.B2B,
        entregas: { some: { fecha, estado: { not: EstadoEntrega.CANCELADA } } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        folio: true,
        detalleB2b: { select: { negocioNombre: true } },
        entregas: {
          where: { fecha, estado: { not: EstadoEntrega.CANCELADA } },
          select: { items: { select: { cantidad: true } } },
        },
      },
    });

    return pedidos
      .map((pedido) => ({
        folio: pedido.folio,
        negocioNombre: pedido.detalleB2b!.negocioNombre,
        cantidad: pedido.entregas.reduce(
          (suma, e) => suma + e.items.reduce((s, i) => s + i.cantidad, 0),
          0,
        ),
      }))
      .filter((entrega) => entrega.cantidad > 0);
  }

  /** Carga una orden B2B del tenant de la sesión (404 si no existe, es de otro tenant o no es B2B). */
  private async cargar(id: string, conEntregas = false) {
    const orden = await this.tenantPrisma.client.order.findFirst({
      where: { id, tipo: TipoOrden.B2B },
      include: conEntregas ? INCLUDE_PEDIDO_ADMIN : INCLUDE_PEDIDO,
    });
    if (!orden || !orden.detalleB2b) {
      throw new NotFoundException('Pedido no encontrado');
    }
    return orden;
  }

  // Único GET con las entregas (y su estado): el panel lo usa al abrir el pedido. Las demás respuestas conservan su forma.
  async findOne(id: string) {
    const orden = await this.cargar(id, true);
    const d = orden.detalleB2b!;
    const codigo = d.codigoDescuentoId
      ? await this.tenantPrisma.client.pedidoB2bCodigoDescuento.findUnique({
          where: { id: d.codigoDescuentoId },
        })
      : null;
    // Solo en este GET (el panel lateral): la nota del cliente y el código ACTUAL del cliente (el código no cambia nunca).
    // Se lee aquí porque el Operador no puede consultar /clientes-b2b/:id.
    const cliente = await this.tenantPrisma.client.cliente.findFirst({
      where: { id: orden.clienteId },
      select: { codigo: true },
    });
    return {
      ...aRespuestaPedidoB2b(orden, { conCodigo: codigo }),
      notaCliente: d.notaCliente,
      clienteCodigo: cliente?.codigo ?? null,
    };
  }

  /**
   * ¿Ya tiene este cliente un pedido (no cancelado) en esa semana? Lo usa la captura del panel para avisar ANTES de guardar.
   * Devuelve folio e id del existente, o null. Cliente de otro negocio o que no es B2B: 404, igual que al crear.
   */
  async existente(clienteId: string, semanaInicioStr: string) {
    const semanaInicio = assertLunes(semanaInicioStr);
    const cliente = await this.tenantPrisma.client.cliente.findFirst({
      where: { id: clienteId, canal: ClienteCanal.B2B },
      select: { id: true },
    });
    if (!cliente) {
      throw new NotFoundException('Cliente no encontrado');
    }
    const orden = await this.tenantPrisma.client.order.findFirst({
      where: {
        tipo: TipoOrden.B2B,
        clienteId,
        cancelado: false,
        detalleB2b: { semanaInicio },
      },
      select: { id: true, folio: true },
    });
    return orden ? { id: orden.id, folio: orden.folio } : null;
  }

  /**
   * Captura de un pedido desde el panel (los 3 roles). El pedido pertenece a un cliente B2B dado de alta: de él salen el
   * nombre del negocio, el contacto (nombre + teléfono principal), el % de descuento y la modalidad de cobro, todo
   * guardado como snapshot en el pedido (si el cliente cambia después, el pedido no). Ya no crea ni toca clientes.
   *
   * Un pedido por cliente por semana (los cancelados no cuentan): se revisa con el cliente bloqueado (FOR UPDATE), así dos
   * capturas simultáneas no pueden crear dos. Orden de bloqueos: cliente → folio.
   */
  async create(tenantId: string, dto: CreatePedidoB2bDto) {
    // Tenant no está registrado en TenantPrismaService (es la raíz, no un
    // modelo tenant-owned) — se lee directo con PrismaService, mismo patrón
    // que TenantService.
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { pedidoB2bModoCobro: true, pedidoB2bMinimoPiezas: true },
    });

    const semanaInicio = assertLunes(dto.semanaInicio);

    // Cliente de otro negocio, inexistente o que no es B2B: el mismo 404 (no confirma que existe).
    const previo = await this.tenantPrisma.client.cliente.findFirst({
      where: { id: dto.clienteId, canal: ClienteCanal.B2B },
      select: { id: true },
    });
    if (!previo) {
      throw new NotFoundException('Cliente no encontrado');
    }

    const { resueltos, totalPiezas, subtotal } = await resolverItems(
      this.tenantPrisma.client,
      tenantId,
      dto.items,
    );

    return this.tenantPrisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${dto.clienteId} AND "tenantId" = ${tenantId} FOR UPDATE`;
      // Se lee de nuevo ya con el candado: baja, descuento y modalidad son los vigentes en este instante.
      const cliente = await tx.cliente.findFirstOrThrow({
        where: { id: dto.clienteId },
        include: { telefonos: { where: { principal: true }, take: 1 } },
      });
      if (cliente.bajaAt) {
        throw new ConflictException(
          'El cliente está dado de baja: no puede tener pedidos nuevos',
        );
      }
      const principal = cliente.telefonos[0];
      if (!principal) {
        throw new ConflictException(
          'El cliente no tiene un teléfono principal: agrégalo antes de capturar el pedido',
        );
      }

      const existente = await tx.order.findFirst({
        where: {
          tipo: TipoOrden.B2B,
          clienteId: cliente.id,
          cancelado: false,
          detalleB2b: { semanaInicio },
        },
        select: { id: true, folio: true },
      });
      if (existente) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: `Este cliente ya tiene el pedido ${existente.folio} para esa semana. Para agregar o cambiar entregas, edita ese pedido.`,
          folio: existente.folio,
          pedidoId: existente.id,
        });
      }

      const descuentoPorcentaje = cliente.descuentoPorcentaje
        ? Number(cliente.descuentoPorcentaje)
        : null;
      const descuentoTotal = descuentoPorcentaje
        ? round2(subtotal * (descuentoPorcentaje / 100))
        : 0;
      const total = round2(subtotal - descuentoTotal);
      const folio = await nextFolioPedidoB2b(tx, tenantId);

      const orden = await crearOrdenB2b(
        tx,
        {
          tenantId,
          folio,
          clienteId: cliente.id,
          negocioNombre: cliente.nombre,
          contactoNombre: principal.nombreContacto ?? cliente.nombre,
          contactoTelefono: principal.telefono,
          contactoCorreo: cliente.correo,
          semanaInicio,
          modoCobro: cliente.modalidadPago ?? tenant.pedidoB2bModoCobro,
          minimoPiezasAplicado: tenant.pedidoB2bMinimoPiezas,
          totalPiezas,
          subtotal,
          descuentoTotal,
          total,
          // El descuento del cliente no es un código: solo se guarda el % aplicado.
          codigoDescuentoId: null,
          codigoDescuentoTexto: null,
          descuentoPorcentajeAplicado: descuentoPorcentaje,
          notaCliente: dto.notaCliente?.trim() || null,
        },
        resueltos,
      );

      // Un pedido B2B cuenta desde que nace (cancelado = false), sin depender de estadoPago.
      await recalcularContadoresCliente(tx, cliente.id);

      return aRespuestaPedidoB2b(
        await tx.order.findUniqueOrThrow({
          where: { id: orden.id },
          include: INCLUDE_PEDIDO,
        }),
      );
    });
  }

  /** Un pedido Pagado solo lo edita o cancela un administrador; al Operador se le niega con 403. */
  private assertPuedeModificarPagado(
    pedido: { estadoPago: EstadoPago },
    rol: Role,
    accion: string,
  ) {
    if (
      pedido.estadoPago === EstadoPago.PAGADO &&
      !puedeEditarPedidoPagado(rol)
    ) {
      throw new ForbiddenException(
        `Este pedido ya está pagado — solo un administrador puede ${accion}`,
      );
    }
  }

  /**
   * Reemplazo completo de items/distribución sobre un pedido existente — ver
   * UpdatePedidoB2bItemsDto: el cliente manda el conjunto completo. Etapa 2: se aplica como DIFF (sincronizarOrdenB2b),
   * conservando la identidad de los ítems y entregas que siguen existiendo. El código/porcentaje de descuento no es
   * editable aquí (no forma parte del alcance de edición descrito), solo se reaplica sobre el nuevo subtotal.
   */
  async updateItems(id: string, dto: UpdatePedidoB2bItemsDto, rol: Role) {
    const pedido = await this.cargar(id);
    this.assertActivo(pedido);
    // Se puede editar en Por confirmar, Confirmado, En proceso y Completado (agregar una entrega a un Completado lo regresa
    // a En proceso). Las entregas ya cerradas no se tocan aquí: sincronizarOrdenB2b da 409 si el cambio las afecta.
    // Un pedido Pagado no bloquea la edición para Gerente/Dueño (admin). Para el Operador sí: queda bloqueado
    // (docs/diseno-operacion.md, "Roles y permisos") — 403. El pago nunca cambia solo al editar.
    this.assertPuedeModificarPagado(pedido, rol, 'editarlo');

    const detalle = pedido.detalleB2b!;
    // Los totales NO salen de lo que se pidió: se recalculan abajo con la regla actual (todas las líneas al precio actual
    // del catálogo, solo entregas no canceladas, % de descuento del pedido).
    const { resueltos, totalPiezas } = await resolverItems(
      this.tenantPrisma.client,
      pedido.tenantId,
      dto.items,
    );

    return this.tenantPrisma.client.$transaction(async (tx) => {
      // Serializa ediciones concurrentes del mismo pedido: la regla "una entrega por fecha" vive aquí, no en la base.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
      await sincronizarOrdenB2b(
        tx,
        pedido.tenantId,
        id,
        detalle.semanaInicio,
        resueltos,
      );
      await tx.detalleB2B.update({
        where: { orderId: id },
        data: { totalPiezas },
      });
      await recalcularTotalesB2b(tx, id);
      // Una entrega nueva en un Completado (o una quitada/agregada en general) puede cambiar el estado calculado.
      await recalcularEstadoB2b(tx, id);

      return aRespuestaPedidoB2b(
        await tx.order.findUniqueOrThrow({
          where: { id },
          include: INCLUDE_PEDIDO,
        }),
      );
    });
  }

  /**
   * PATCH /:id/avanzar — SOLO Por confirmar → Confirmado (manual). Los demás estados (En proceso, Completado) se calculan
   * de las entregas al cerrarlas (cerrarEntrega); "despachar" ya no existe para B2B. Nunca acepta un estado del cliente.
   * Al confirmar aplica las reglas de mínimo de piezas / modo de cobro descritas en CLAUDE.md.
   */
  async avanzar(id: string) {
    const pedido = await this.cargar(id);
    this.assertActivo(pedido);
    const detalle = pedido.detalleB2b!;

    if (pedido.estadoPedido !== EstadoPedido.PENDIENTE_CONFIRMACION) {
      throw new ConflictException(
        'Este pedido ya está confirmado — su avance depende de cerrar sus entregas (Entregada o No recogida)',
      );
    }
    if (detalle.modoCobro === 'AL_INICIO') {
      throw new ConflictException(
        'Este pedido requiere pago para confirmarse — usa /pedidos-b2b/:id/marcar-pagado',
      );
    }
    // AL_FINAL: el mínimo de piezas bloquea la confirmación, y solo aquí —
    // una vez confirmado nunca se vuelve a revalidar (ver updateItems).
    if (detalle.totalPiezas < detalle.minimoPiezasAplicado) {
      throw new ConflictException(
        `Este pedido no alcanza el mínimo de ${detalle.minimoPiezasAplicado} piezas (tiene ${detalle.totalPiezas})`,
      );
    }

    const siguiente = EstadoPedido.CONFIRMADO_SURTIENDO;
    const actualizado = aRespuestaPedidoB2b(
      await this.tenantPrisma.client.order.update({
        where: { id },
        data: { estadoPedido: siguiente },
        include: INCLUDE_PEDIDO,
      }),
    );

    // Reglas EVENTO_PEDIDO (Módulo 3, Etapa 2c) — ver el mismo comentario en
    // OrdersService.avanzar. void + fire-and-forget: nunca debe sumarle al
    // request la latencia del POST a Botpress. Único evento B2B: Confirmado (sin eventos nuevos).
    void this.reglaEventoPedidoService.dispararSeguro({
      tenantId: actualizado.tenantId,
      origen: 'PEDIDO_B2B',
      estatus: siguiente,
      clienteId: actualizado.clienteId,
      contexto: this.contextoPedidoParaReglas(actualizado),
    });

    return actualizado;
  }

  /**
   * PATCH /:id/entregas/:entregaId/cerrar — cierra UNA entrega (Pendiente → Entregada | No recogida), nunca en bloque.
   * Solo en pedidos Confirmados o En proceso; una entrega ya cerrada no se vuelve a cerrar aquí (la corrección del admin es
   * otra entrega). Guarda fecha y hora del cierre (estadoCambiadoAt), sin usuario. Recalcula el estado del pedido
   * (En proceso / Completado). No dispara eventos de notificación.
   */
  async cerrarEntrega(id: string, entregaId: string, dto: CerrarEntregaB2bDto) {
    await this.cargar(id); // 404 si no existe / otro tenant / no es B2B
    return this.tenantPrisma.client.$transaction(async (tx) => {
      // Serializa contra otros cierres y ediciones del mismo pedido; el estado se revisa YA bajo el candado.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
      const orden = await tx.order.findUniqueOrThrow({
        where: { id },
        select: { estadoPedido: true, cancelado: true },
      });
      if (orden.cancelado)
        throw new ConflictException('Este pedido está cancelado');
      const estado = estadoB2bVisible(orden.estadoPedido);
      if (
        estado !== EstadoPedido.CONFIRMADO_SURTIENDO &&
        estado !== EstadoPedido.EN_PROCESO
      ) {
        throw new ConflictException(
          'Solo se pueden cerrar entregas de pedidos confirmados o en proceso',
        );
      }
      const entrega = await tx.entrega.findFirst({
        where: { id: entregaId, orderId: id },
        select: { estado: true },
      });
      if (!entrega) throw new NotFoundException('Entrega no encontrada');
      if (
        entrega.estado !== EstadoEntrega.PENDIENTE &&
        entrega.estado !== EstadoEntrega.LISTA
      ) {
        throw new ConflictException('Esta entrega ya está cerrada');
      }
      await tx.entrega.update({
        where: { id: entregaId },
        data: { estado: dto.estado, estadoCambiadoAt: new Date() },
      });
      await recalcularEstadoB2b(tx, id);
      return aRespuestaPedidoB2b(
        await tx.order.findUniqueOrThrow({
          where: { id },
          include: INCLUDE_PEDIDO_ADMIN,
        }),
      );
    });
  }

  /**
   * PATCH /:id/marcar-pagado (Gerente/Dueño). Marca Pagado en CUALQUIER estado del pedido, incluso Cancelado, y guarda la
   * fecha y hora (`pagadoAt`, sin usuario). El pago nunca cambia solo: ni al corregir, ni al editar, ni al cancelar.
   *
   * Modo AL_INICIO (pago anticipado) conserva su comportamiento: si el pedido sigue Por confirmar (y no está cancelado), el
   * mínimo de piezas se valida aquí y, al pagar, el pedido se confirma en el mismo paso. Si ya pasó de Por confirmar (p. ej.
   * se desmarcó y se vuelve a marcar) solo se marca el pago — no se vuelve a validar el mínimo ni se mueve el estado.
   * En modo AL_FINAL (crédito) solo cambia el pago.
   */
  async marcarPagado(id: string) {
    await this.cargar(id); // 404 si no existe / otro tenant / no es B2B
    const { actualizado, confirmo } =
      await this.tenantPrisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
        const orden = await tx.order.findUniqueOrThrow({
          where: { id },
          include: { detalleB2b: true },
        });
        const detalle = orden.detalleB2b!;
        if (orden.estadoPago === EstadoPago.PAGADO) {
          throw new ConflictException('Este pedido ya está pagado');
        }

        const data: Prisma.OrderUpdateInput = { estadoPago: EstadoPago.PAGADO };
        const confirma =
          detalle.modoCobro === 'AL_INICIO' &&
          !orden.cancelado &&
          orden.estadoPedido === EstadoPedido.PENDIENTE_CONFIRMACION;
        if (confirma) {
          if (detalle.totalPiezas < detalle.minimoPiezasAplicado) {
            throw new ConflictException(
              `Este pedido no alcanza el mínimo de ${detalle.minimoPiezasAplicado} piezas para procesar el pago (tiene ${detalle.totalPiezas})`,
            );
          }
          data.estadoPedido = EstadoPedido.CONFIRMADO_SURTIENDO;
        }
        await tx.order.update({ where: { id }, data });
        await tx.detalleB2B.update({
          where: { orderId: id },
          data: { pagadoAt: new Date() },
        });
        return {
          actualizado: aRespuestaPedidoB2b(
            await tx.order.findUniqueOrThrow({
              where: { id },
              include: INCLUDE_PEDIDO,
            }),
          ),
          confirmo: confirma,
        };
      });

    // Reglas EVENTO_PEDIDO (Módulo 3, Etapa 2c) — solo si esta llamada de verdad movió `estado` (rama AL_INICIO).
    // En AL_FINAL marcarPagado nunca cambia `estado`, así que no hay evento de estatus que disparar aquí.
    if (confirmo) {
      void this.reglaEventoPedidoService.dispararSeguro({
        tenantId: actualizado.tenantId,
        origen: 'PEDIDO_B2B',
        estatus: EstadoPedido.CONFIRMADO_SURTIENDO,
        clienteId: actualizado.clienteId,
        contexto: this.contextoPedidoParaReglas(actualizado),
      });
    }

    // No cambia el conteo (B2B cuenta por no cancelado, no por estadoPago); se recalcula
    // por consistencia con el resto de los ganchos — es idempotente.
    await recalcularContadoresCliente(
      this.tenantPrisma.client,
      actualizado.clienteId,
    );

    return actualizado;
  }

  /**
   * PATCH /:id/desmarcar-pagado (Gerente/Dueño). Regresa el pago a Pendiente y limpia la fecha (deshacer un error, o un
   * reembolso). Solo toca el pago: NUNCA mueve el estado del pedido — en AL_INICIO un pedido que se confirmó al pagarse
   * sigue Confirmado aunque se desmarque (decide el admin, ver docs/diseno-operacion.md). Sirve en cualquier estado.
   */
  async desmarcarPagado(id: string) {
    await this.cargar(id);
    return this.tenantPrisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
      const orden = await tx.order.findUniqueOrThrow({
        where: { id },
        select: { estadoPago: true },
      });
      if (orden.estadoPago !== EstadoPago.PAGADO) {
        throw new ConflictException('Este pedido no está pagado');
      }
      await tx.order.update({
        where: { id },
        data: { estadoPago: EstadoPago.PENDIENTE },
      });
      await tx.detalleB2B.update({
        where: { orderId: id },
        data: { pagadoAt: null },
      });
      return aRespuestaPedidoB2b(
        await tx.order.findUniqueOrThrow({
          where: { id },
          include: INCLUDE_PEDIDO,
        }),
      );
    });
  }

  /**
   * PATCH /:id/entregas/:entregaId/corregir (Gerente/Dueño) — corrección del admin sobre una entrega YA CERRADA (Entregada
   * o No recogida) por un error en el envío: cambia productos, cantidades y el estado (solo entre Entregada y No recogida).
   * Sirve en cualquier estado del pedido: Pagado, Completado o Cancelado (las cerradas de un cancelado se conservan).
   *
   * Recalcula con la regla actual: TODAS las líneas del pedido toman nombre y precio actuales del catálogo, y se reaplica el %
   * de descuento del pedido sobre las entregas no canceladas. NO cambia el estado del pedido (las entregas siguen cerradas),
   * NO toca el pago, NO conserva usuario y NO dispara notificaciones. Conserva la fecha/hora del cierre original.
   * Una línea nueva reutiliza el ítem del pedido de ese producto si existe (otro día) o crea uno; un ítem que se queda sin
   * ninguna entrega se elimina, y `OrderItem.cantidad` vuelve a ser la suma de sus entregas.
   */
  async corregirEntrega(
    id: string,
    entregaId: string,
    dto: CorregirEntregaB2bDto,
  ) {
    await this.cargar(id);
    const ids = dto.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'Hay un producto repetido en la corrección — junta sus cantidades en una sola línea',
      );
    }

    return this.tenantPrisma.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
      const orden = await tx.order.findUniqueOrThrow({
        where: { id },
        select: { tenantId: true },
      });
      const entrega = await tx.entrega.findFirst({
        where: { id: entregaId, orderId: id },
        include: { items: true },
      });
      if (!entrega) throw new NotFoundException('Entrega no encontrada');
      if (!ESTADOS_ENTREGA_CERRADOS.includes(entrega.estado)) {
        throw new ConflictException(
          'Solo se pueden corregir entregas ya cerradas (Entregada o No recogida)',
        );
      }

      const productos = await tx.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, nombre: true, precio: true },
      });
      if (productos.length !== ids.length) {
        throw new NotFoundException(
          'Uno o más productos no existen en este negocio',
        );
      }
      const producto = new Map(productos.map((p) => [p.id, p]));

      // --- 1. Las líneas de ESTA entrega pasan a ser exactamente `dto.items`.
      const items = await tx.orderItem.findMany({
        where: { orderId: id },
        orderBy: [{ orden: 'asc' }, { id: 'asc' }],
      });
      const itemDe = new Map(
        items.filter((i) => i.productId).map((i) => [i.productId!, i]),
      );
      const idItemsEnEntrega = new Map(
        entrega.items.map((ei) => [ei.orderItemId, ei]),
      );
      const deseados = new Set<string>(); // orderItem.id que quedan en la entrega
      let siguienteOrden = items.reduce((m, i) => Math.max(m, i.orden), -1) + 1;
      for (const linea of dto.items) {
        const p = producto.get(linea.productId)!;
        let item = itemDe.get(linea.productId);
        if (!item) {
          item = await tx.orderItem.create({
            data: {
              tenantId: orden.tenantId,
              orderId: id,
              productId: p.id,
              nombreProducto: p.nombre,
              precioUnitario: p.precio,
              cantidad: linea.cantidad,
              orden: siguienteOrden++,
            },
          });
          itemDe.set(p.id, item);
          items.push(item);
        }
        deseados.add(item.id);
        const fila = idItemsEnEntrega.get(item.id);
        if (fila) {
          if (fila.cantidad !== linea.cantidad)
            await tx.entregaItem.update({
              where: { id: fila.id },
              data: { cantidad: linea.cantidad },
            });
        } else {
          await tx.entregaItem.create({
            data: {
              tenantId: orden.tenantId,
              entregaId,
              orderItemId: item.id,
              cantidad: linea.cantidad,
            },
          });
        }
      }
      for (const fila of entrega.items) {
        if (!deseados.has(fila.orderItemId))
          await tx.entregaItem.delete({ where: { id: fila.id } });
      }

      // --- 2. Estado de la entrega (solo Entregada <-> No recogida); la fecha/hora del cierre original se conserva.
      if (dto.estado && dto.estado !== entrega.estado) {
        await tx.entrega.update({
          where: { id: entregaId },
          data: { estado: dto.estado },
        });
      }

      // --- 3. Todas las líneas toman el precio (y nombre) actual del catálogo; luego cantidad = suma de sus entregas.
      const idsCatalogo = [
        ...new Set(
          items.map((i) => i.productId).filter((x): x is string => !!x),
        ),
      ];
      const actuales = new Map(
        (
          await tx.product.findMany({
            where: { id: { in: idsCatalogo } },
            select: { id: true, nombre: true, precio: true },
          })
        ).map((p) => [p.id, p]),
      );
      let totalPiezas = 0;
      for (const item of items) {
        const suma =
          (
            await tx.entregaItem.aggregate({
              where: { orderItemId: item.id },
              _sum: { cantidad: true },
            })
          )._sum.cantidad ?? 0;
        if (suma === 0) {
          await tx.orderItem.delete({ where: { id: item.id } }); // se quedó sin ninguna entrega
          continue;
        }
        const p = item.productId ? actuales.get(item.productId) : undefined;
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            cantidad: suma,
            ...(p
              ? { nombreProducto: p.nombre, precioUnitario: p.precio }
              : {}),
          },
        });
        totalPiezas += suma;
      }
      await tx.detalleB2B.update({
        where: { orderId: id },
        data: { totalPiezas },
      });
      await recalcularTotalesB2b(tx, id); // sin recalcularEstadoB2b: el estado del pedido no cambia

      return aRespuestaPedidoB2b(
        await tx.order.findUniqueOrThrow({
          where: { id },
          include: INCLUDE_PEDIDO_ADMIN,
        }),
      );
    });
  }

  /**
   * PATCH /:id/cancelar. Cancelación es un flag ortogonal a `estado` (ver schema.prisma). Se permite en Por confirmar,
   * Confirmado y En proceso; no en Completado ni Cancelado. Las entregas ya cerradas (Entregada / No recogida) se
   * conservan y se cobran; las pendientes pasan a CANCELADA y no se cobran: el total se recalcula solo con las vigentes.
   */
  async cancelar(id: string, rol: Role) {
    const pedido = await this.cargar(id);
    this.assertPuedeModificarPagado(pedido, rol, 'cancelarlo');
    if (pedido.cancelado) {
      throw new ConflictException('Este pedido ya está cancelado');
    }
    if (ESTADOS_B2B_COMPLETADOS.includes(pedido.estadoPedido)) {
      throw new ConflictException('No puedes cancelar un pedido ya completado');
    }

    const cancelado = aRespuestaPedidoB2b(
      await this.tenantPrisma.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
        // Revalida bajo el candado: un cierre simultáneo pudo completar el pedido.
        const actual = await tx.order.findUniqueOrThrow({
          where: { id },
          select: { estadoPedido: true, cancelado: true },
        });
        if (actual.cancelado)
          throw new ConflictException('Este pedido ya está cancelado');
        if (ESTADOS_B2B_COMPLETADOS.includes(actual.estadoPedido)) {
          throw new ConflictException(
            'No puedes cancelar un pedido ya completado',
          );
        }
        const ahora = new Date();
        await tx.order.update({
          where: { id },
          data: { cancelado: true, canceladoAt: ahora },
        });
        await tx.entrega.updateMany({
          where: {
            orderId: id,
            estado: { in: [EstadoEntrega.PENDIENTE, EstadoEntrega.LISTA] },
          },
          data: { estado: EstadoEntrega.CANCELADA, estadoCambiadoAt: ahora },
        });
        await recalcularTotalesB2b(tx, id);
        return tx.order.findUniqueOrThrow({
          where: { id },
          include: INCLUDE_PEDIDO,
        });
      }),
    );
    // Un pedido cancelado deja de contar en los contadores del Cliente.
    await recalcularContadoresCliente(
      this.tenantPrisma.client,
      cancelado.clienteId,
    );
    return cancelado;
  }

  private assertActivo(pedido: { cancelado: boolean }) {
    if (pedido.cancelado) {
      throw new ConflictException('Este pedido está cancelado');
    }
  }

  /**
   * PedidoContexto para las Reglas de notificación EVENTO_PEDIDO (ver
   * ReglaEventoPedidoService/CATALOGO_VARIABLES) — compartido por avanzar()
   * y marcarPagado(), las dos únicas transiciones de estado que disparan
   * una Regla. PedidoB2b no tiene tipo de entrega/dirección/método de pago
   * propio (ver auditoría del catálogo), así que su contexto es el
   * subconjunto sin esos 3 campos (a diferencia de Order, ver
   * OrdersService.avanzar).
   */
  private contextoPedidoParaReglas(pedido: {
    folio: string;
    total: Prisma.Decimal;
    estado: EstadoPedido;
    createdAt: Date;
    items: { nombreProducto: string; cantidadTotal: number }[];
  }): PedidoContexto {
    return {
      origen: 'PEDIDO_B2B',
      folio: pedido.folio,
      total: pedido.total,
      estatus: pedido.estado as unknown as PedidoB2bEstado,
      createdAt: pedido.createdAt,
      items: pedido.items.map((item) => ({
        nombreProducto: item.nombreProducto,
        cantidad: item.cantidadTotal,
      })),
    };
  }
}
