import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { round2 } from '../common/money';
import { toCsv } from '../common/csv';
import {
  ClienteCanal,
  EstadoEntrega,
  EstadoPago,
  EstadoPedido,
  PedidoB2bEstado,
  Prisma,
  TipoOrden,
} from '../../generated/prisma/client';
import { recalcularContadoresCliente, type ClienteContadoresDb } from '../clientes/cliente-contadores';
import { ClientesService } from '../clientes/clientes.service';
import { ReglaEventoPedidoService } from '../notificaciones-reglas/regla-evento-pedido.service';
import { PedidoContexto } from '../notificaciones-reglas/plantilla-variable.type';
import { CreatePedidoB2bDto } from './dto/create-pedido-b2b.dto';
import { UpdatePedidoB2bItemsDto } from './dto/update-pedido-b2b-items.dto';
import { ListPedidosB2bQueryDto } from './dto/list-pedidos-b2b-query.dto';
import { ExportPedidosB2bQueryDto } from './dto/export-pedidos-b2b-query.dto';
import { FiltroImporteOperador, filtroImporteWhere } from '../common/filtro-importe';
import {
  assertLunes,
  calcularSemanaDestino,
  diasEntreFechasISO,
  fechaMexicoYMD,
  nextFolioPedidoB2b,
  resolverCodigoDescuento,
  resolverItems,
  resolverSemanaYDia,
  sumarDiasISO,
} from './pedidos-b2b-logica';
import {
  aRespuestaPedidoB2b,
  crearOrdenB2b,
  fechaDeDia,
  INCLUDE_PEDIDO,
  sincronizarOrdenB2b,
} from './pedidos-b2b-orden';

// Etapa 2: un pedido B2B ES una Order (tipo B2B) + DetalleB2B + OrderItem + Entrega/EntregaItem. Este servicio conserva
// las rutas, reglas y la forma de las respuestas de siempre; el mapeo a la forma plana de PedidoB2b vive en
// aRespuestaPedidoB2b (pedidos-b2b-orden.ts).

// Semana en curso = la que ya se está surtiendo/despachando (resolverSemanaYDia
// de "hoy"), nunca calcularSemanaDestino (que siempre da la semana siguiente,
// pensada para pedidos nuevos entrando por el storefront). Mismo criterio de
// "activo" que ya usa findEntregasDia — no despachados, no cancelados.
const ESTADOS_ACTIVOS: EstadoPedido[] = [
  EstadoPedido.PENDIENTE_CONFIRMACION,
  EstadoPedido.CONFIRMADO_SURTIENDO,
];

// Secuencial, sin marcha atrás. B2B nunca usa LISTO_ENTREGA (existe en EstadoPedido por B2C): de Confirmado salta
// directo a Despachado, igual que siempre. DESPACHADO no tiene siguiente.
const SIGUIENTE_ESTADO: Partial<Record<EstadoPedido, EstadoPedido | null>> = {
  [EstadoPedido.PENDIENTE_CONFIRMACION]: EstadoPedido.CONFIRMADO_SURTIENDO,
  [EstadoPedido.CONFIRMADO_SURTIENDO]: EstadoPedido.DESPACHADO,
  [EstadoPedido.DESPACHADO]: null,
};

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
  detalleB2b: { select: { negocioNombre: true, semanaInicio: true, modoCobro: true, totalPiezas: true } },
} satisfies Prisma.OrderSelect;

function aReportable(o: Prisma.OrderGetPayload<{ select: typeof REPORTABLE_SELECT }>) {
  const d = o.detalleB2b!;
  return {
    id: o.id,
    folio: o.folio,
    negocioNombre: d.negocioNombre,
    contactoNombre: o.clienteNombre,
    semanaInicio: d.semanaInicio,
    estado: o.estadoPedido,
    estadoPago: o.estadoPago,
    modoCobro: d.modoCobro,
    cancelado: o.cancelado,
    totalPiezas: d.totalPiezas,
    total: o.total,
    createdAt: o.createdAt,
  };
}

const comoEstado = (e: PedidoB2bEstado) => e as unknown as EstadoPedido;

@Injectable()
export class PedidosB2bService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly clientesService: ClientesService,
    private readonly reglaEventoPedidoService: ReglaEventoPedidoService,
  ) {}

  private buildWhere(query: {
    estado?: PedidoB2bEstado;
    estados?: PedidoB2bEstado[];
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
    return {
      tipo: TipoOrden.B2B,
      // `estados` (multi-valor) tiene prioridad si llega — ver
      // ExportPedidosB2bQueryDto para el motivo (vista "activos" con dos
      // estatus a la vez, sin pestaña por estatus).
      estadoPedido: query.estados ? { in: query.estados.map(comoEstado) } : query.estado ? comoEstado(query.estado) : undefined,
      cancelado: query.cancelado,
      total: filtroImporteWhere(query.operador, query.valor, query.valorHasta),
      // Siempre hay detalle en una orden B2B; el filtro solo se agrega si realmente se filtra por él.
      ...(detalle.semanaInicio || detalle.negocioNombre ? { detalleB2b: detalle } : {}),
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
   * "Pedidos del día" — todos los pedidos activos (no despachados/cancelados)
   * con algo programado para entregarse en `fechaStr`, con `items` ya
   * recortados a solo las cantidades de ese día (nunca el pedido completo).
   * Etapa 2: la fecha es la de una Entrega real (antes se derivaba de semanaInicio + día de la semana).
   */
  async findEntregasDia(fechaStr: string) {
    const { semanaInicio, dia } = resolverSemanaYDia(fechaStr);
    const fecha = fechaDeDia(semanaInicio, dia);

    const pedidos = await this.tenantPrisma.client.order.findMany({
      where: {
        tipo: TipoOrden.B2B,
        cancelado: false,
        estadoPedido: { in: ESTADOS_ACTIVOS },
        entregas: { some: { fecha } },
      },
      orderBy: { detalleB2b: { negocioNombre: 'asc' } },
      select: {
        id: true,
        folio: true,
        clienteNombre: true,
        clienteTelefono: true,
        estadoPedido: true,
        detalleB2b: { select: { negocioNombre: true } },
        items: {
          orderBy: [{ orden: 'asc' }, { id: 'asc' }],
          select: {
            productId: true,
            nombreProducto: true,
            precioUnitario: true,
            // Solo las cantidades de esa fecha (a lo más una fila por ítem: regla B2B de una entrega por fecha).
            entregaItems: { where: { entrega: { fecha } }, select: { cantidad: true } },
          },
        },
      },
    });

    return pedidos
      .map((pedido) => ({
        id: pedido.id,
        folio: pedido.folio,
        negocioNombre: pedido.detalleB2b!.negocioNombre,
        contactoNombre: pedido.clienteNombre,
        contactoTelefono: pedido.clienteTelefono,
        estado: pedido.estadoPedido,
        items: pedido.items
          .map((item) => ({
            productId: item.productId,
            nombreProducto: item.nombreProducto,
            precioUnitario: item.precioUnitario,
            cantidad: item.entregaItems.reduce((suma, ei) => suma + ei.cantidad, 0),
          }))
          .filter((item) => item.cantidad > 0),
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

    const b2bSemanaEnCurso = (estados: EstadoPedido[]): Prisma.OrderWhereInput => ({
      tipo: TipoOrden.B2B,
      cancelado: false,
      estadoPedido: { in: estados },
      detalleB2b: { semanaInicio: semanaEnCursoInicio },
    });

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
      this.tenantPrisma.client.order.count({ where: b2bSemanaEnCurso([EstadoPedido.PENDIENTE_CONFIRMACION]) }),
      this.tenantPrisma.client.order.count({ where: b2bSemanaEnCurso([EstadoPedido.CONFIRMADO_SURTIENDO]) }),
      this.tenantPrisma.client.detalleB2B.aggregate({
        where: { semanaInicio: semanaEnCursoInicio, order: b2bSemanaEnCurso(ESTADOS_ACTIVOS) },
        _sum: { totalPiezas: true },
      }),
      this.entregasResumenDia(hoy),
      this.entregasResumenDia(manana),
      this.tenantPrisma.client.order.findMany({
        where: { tipo: TipoOrden.B2B, cancelado: false, estadoPedido: EstadoPedido.PENDIENTE_CONFIRMACION },
        orderBy: { createdAt: 'asc' },
        take: 10,
        select: { id: true, folio: true, createdAt: true, detalleB2b: { select: { negocioNombre: true } } },
      }),
      this.tenantPrisma.client.detalleB2B.aggregate({
        where: { semanaInicio: semanaSiguienteInicio, order: { tipo: TipoOrden.B2B, cancelado: false } },
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
            detalleB2b: { semanaInicio: { in: [semanaEnCursoInicio, semanaSiguienteInicio] } },
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
      where: {
        tipo: TipoOrden.B2B,
        cancelado: false,
        estadoPedido: { in: ESTADOS_ACTIVOS },
        entregas: { some: { fecha } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        folio: true,
        detalleB2b: { select: { negocioNombre: true } },
        entregas: { where: { fecha }, select: { items: { select: { cantidad: true } } } },
      },
    });

    return pedidos
      .map((pedido) => ({
        folio: pedido.folio,
        negocioNombre: pedido.detalleB2b!.negocioNombre,
        cantidad: pedido.entregas.reduce((suma, e) => suma + e.items.reduce((s, i) => s + i.cantidad, 0), 0),
      }))
      .filter((entrega) => entrega.cantidad > 0);
  }

  /** Carga una orden B2B del tenant de la sesión (404 si no existe, es de otro tenant o no es B2B). */
  private async cargar(id: string) {
    const orden = await this.tenantPrisma.client.order.findFirst({
      where: { id, tipo: TipoOrden.B2B },
      include: INCLUDE_PEDIDO,
    });
    if (!orden || !orden.detalleB2b) {
      throw new NotFoundException('Pedido no encontrado');
    }
    return orden;
  }

  async findOne(id: string) {
    const orden = await this.cargar(id);
    const d = orden.detalleB2b!;
    const codigo = d.codigoDescuentoId
      ? await this.tenantPrisma.client.pedidoB2bCodigoDescuento.findUnique({ where: { id: d.codigoDescuentoId } })
      : null;
    return aRespuestaPedidoB2b(orden, { conCodigo: codigo });
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

      // Antes de crear el pedido — clienteId es FK requerida desde Módulo 2.
      const cliente = await this.clientesService.sincronizarDesdePedido(tx, {
        tenantId,
        canal: ClienteCanal.B2B,
        telefono: dto.contactoTelefono,
        nombre: dto.contactoNombre,
        correo: dto.contactoCorreo,
        fechaPedido: new Date(),
      });

      const orden = await crearOrdenB2b(
        tx,
        {
          tenantId,
          folio,
          clienteId: cliente.id,
          negocioNombre: dto.negocioNombre,
          contactoNombre: dto.contactoNombre,
          contactoTelefono: dto.contactoTelefono,
          contactoCorreo: dto.contactoCorreo,
          semanaInicio,
          modoCobro: tenant.pedidoB2bModoCobro,
          minimoPiezasAplicado: tenant.pedidoB2bMinimoPiezas,
          totalPiezas,
          subtotal,
          descuentoTotal,
          total,
          codigoDescuentoId,
          codigoDescuentoTexto,
          descuentoPorcentajeAplicado,
        },
        resueltos,
      );

      // Un pedido B2B cuenta desde que nace (cancelado = false), sin depender de estadoPago.
      await recalcularContadoresCliente(tx as unknown as ClienteContadoresDb, cliente.id);

      return aRespuestaPedidoB2b(
        await tx.order.findUniqueOrThrow({ where: { id: orden.id }, include: INCLUDE_PEDIDO }),
      );
    });
  }

  /**
   * Reemplazo completo de items/distribución sobre un pedido existente — ver
   * UpdatePedidoB2bItemsDto: el cliente manda el conjunto completo. Etapa 2: se aplica como DIFF (sincronizarOrdenB2b),
   * conservando la identidad de los ítems y entregas que siguen existiendo. El código/porcentaje de descuento no es
   * editable aquí (no forma parte del alcance de edición descrito), solo se reaplica sobre el nuevo subtotal.
   */
  async updateItems(id: string, dto: UpdatePedidoB2bItemsDto) {
    const pedido = await this.cargar(id);
    this.assertActivo(pedido);
    if (pedido.estadoPedido === EstadoPedido.DESPACHADO) {
      throw new ConflictException('No puedes editar un pedido ya despachado');
    }
    // Si el pedido ya está pagado (modo AL_INICIO), no se edita el mismo
    // pedido — se crea uno nuevo e independiente. Ver CLAUDE.md.
    if (pedido.estadoPago === EstadoPago.PAGADO) {
      throw new ConflictException(
        'Este pedido ya está pagado — crea un pedido nuevo para agregar más producto',
      );
    }

    const detalle = pedido.detalleB2b!;
    const { resueltos, totalPiezas, subtotal } = await resolverItems(
      this.tenantPrisma.client,
      pedido.tenantId,
      dto.items,
    );
    const descuentoPorcentaje = detalle.descuentoPorcentajeAplicado
      ? Number(detalle.descuentoPorcentajeAplicado)
      : 0;
    const descuentoTotal = round2(subtotal * (descuentoPorcentaje / 100));
    const total = round2(subtotal - descuentoTotal);

    return this.tenantPrisma.client.$transaction(async (tx) => {
      // Serializa ediciones concurrentes del mismo pedido: la regla "una entrega por fecha" vive aquí, no en la base.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
      await sincronizarOrdenB2b(tx, pedido.tenantId, id, detalle.semanaInicio, resueltos);
      await tx.detalleB2B.update({ where: { orderId: id }, data: { totalPiezas, subtotal } });
      await tx.order.update({ where: { id }, data: { descuentoTotal, total } });

      return aRespuestaPedidoB2b(await tx.order.findUniqueOrThrow({ where: { id }, include: INCLUDE_PEDIDO }));
    });
  }

  /**
   * PATCH /:id/avanzar — calcula el siguiente estado server-side, nunca
   * acepta uno explícito del cliente (mismo principio que
   * OrdersService.avanzar). Al salir de PENDIENTE_CONFIRMACION aplica las
   * reglas de mínimo de piezas / modo de cobro descritas en CLAUDE.md.
   * Al despachar, sus entregas no canceladas pasan a ENTREGADA (un solo sentido, sin UI).
   */
  async avanzar(id: string, usuarioId?: string) {
    const pedido = await this.cargar(id);
    this.assertActivo(pedido);
    const detalle = pedido.detalleB2b!;

    const siguiente = SIGUIENTE_ESTADO[pedido.estadoPedido];
    if (!siguiente) {
      throw new ConflictException('Este pedido ya está despachado');
    }

    if (pedido.estadoPedido === EstadoPedido.PENDIENTE_CONFIRMACION) {
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
    }

    const actualizado = aRespuestaPedidoB2b(
      await this.tenantPrisma.client.$transaction(async (tx) => {
        const orden = await tx.order.update({ where: { id }, data: { estadoPedido: siguiente }, include: INCLUDE_PEDIDO });
        if (siguiente === EstadoPedido.DESPACHADO) {
          await tx.entrega.updateMany({
            where: { orderId: id, estado: { not: EstadoEntrega.CANCELADA } },
            data: { estado: EstadoEntrega.ENTREGADA, estadoCambiadoAt: new Date(), estadoCambiadoPorId: usuarioId ?? null },
          });
        }
        return orden;
      }),
    );

    // Reglas EVENTO_PEDIDO (Módulo 3, Etapa 2c) — ver el mismo comentario en
    // OrdersService.avanzar. void + fire-and-forget: nunca debe sumarle al
    // request la latencia del POST a Botpress.
    void this.reglaEventoPedidoService.dispararSeguro({
      tenantId: actualizado.tenantId,
      origen: 'PEDIDO_B2B',
      estatus: siguiente as unknown as PedidoB2bEstado,
      clienteId: actualizado.clienteId,
      contexto: this.contextoPedidoParaReglas(actualizado),
    });

    return actualizado;
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
    const pedido = await this.cargar(id);
    this.assertActivo(pedido);
    const detalle = pedido.detalleB2b!;

    if (pedido.estadoPago === EstadoPago.PAGADO) {
      throw new ConflictException('Este pedido ya está pagado');
    }

    const data: Prisma.OrderUpdateInput = { estadoPago: EstadoPago.PAGADO };

    if (detalle.modoCobro === 'AL_INICIO') {
      if (pedido.estadoPedido !== EstadoPedido.PENDIENTE_CONFIRMACION) {
        throw new ConflictException('Este pedido ya fue confirmado');
      }
      if (detalle.totalPiezas < detalle.minimoPiezasAplicado) {
        throw new ConflictException(
          `Este pedido no alcanza el mínimo de ${detalle.minimoPiezasAplicado} piezas para procesar el pago (tiene ${detalle.totalPiezas})`,
        );
      }
      data.estadoPedido = EstadoPedido.CONFIRMADO_SURTIENDO;
    }

    const actualizado = aRespuestaPedidoB2b(
      await this.tenantPrisma.client.order.update({ where: { id }, data, include: INCLUDE_PEDIDO }),
    );

    // Reglas EVENTO_PEDIDO (Módulo 3, Etapa 2c) — solo si esta llamada de
    // verdad movió `estado` (rama AL_INICIO). En modo AL_FINAL, marcarPagado
    // nunca cambia `estado` (ver comentario del método), así que no hay
    // ningún evento de estatus que disparar aquí — ver también avanzar(),
    // que sí lo cubre para esa transición.
    if (data.estadoPedido) {
      void this.reglaEventoPedidoService.dispararSeguro({
        tenantId: actualizado.tenantId,
        origen: 'PEDIDO_B2B',
        estatus: data.estadoPedido as unknown as PedidoB2bEstado,
        clienteId: actualizado.clienteId,
        contexto: this.contextoPedidoParaReglas(actualizado),
      });
    }

    // No cambia el conteo (B2B cuenta por no cancelado, no por estadoPago); se recalcula
    // por consistencia con el resto de los ganchos — es idempotente.
    await recalcularContadoresCliente(this.tenantPrisma.client as unknown as ClienteContadoresDb, actualizado.clienteId);

    return actualizado;
  }

  /**
   * PATCH /:id/cancelar. Cancelación es un flag ortogonal a `estado` (ver
   * schema.prisma) — no hay ninguna regla de anticipación que el sistema
   * valide, es una decisión operativa manual, solo bloqueada una vez
   * DESPACHADO. Sus entregas no entregadas pasan a CANCELADA (un solo sentido, sin UI).
   */
  async cancelar(id: string, usuarioId?: string) {
    const pedido = await this.cargar(id);
    if (pedido.cancelado) {
      throw new ConflictException('Este pedido ya está cancelado');
    }
    if (pedido.estadoPedido === EstadoPedido.DESPACHADO) {
      throw new ConflictException('No puedes cancelar un pedido ya despachado');
    }

    const cancelado = aRespuestaPedidoB2b(
      await this.tenantPrisma.client.$transaction(async (tx) => {
        const ahora = new Date();
        const orden = await tx.order.update({
          where: { id },
          data: { cancelado: true, canceladoAt: ahora },
          include: INCLUDE_PEDIDO,
        });
        await tx.entrega.updateMany({
          where: { orderId: id, estado: { notIn: [EstadoEntrega.ENTREGADA, EstadoEntrega.CANCELADA] } },
          data: { estado: EstadoEntrega.CANCELADA, estadoCambiadoAt: ahora, estadoCambiadoPorId: usuarioId ?? null },
        });
        return orden;
      }),
    );
    // Un pedido cancelado deja de contar en los contadores del Cliente.
    await recalcularContadoresCliente(this.tenantPrisma.client as unknown as ClienteContadoresDb, cancelado.clienteId);
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
      items: pedido.items.map((item) => ({ nombreProducto: item.nombreProducto, cantidad: item.cantidadTotal })),
    };
  }
}
