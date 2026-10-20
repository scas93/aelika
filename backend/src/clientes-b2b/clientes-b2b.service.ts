import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClienteCanal, EstadoEntrega, Prisma, TipoOrden } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { normalizarTelefono } from '../common/telefono';
import { crearClienteB2b, type ClienteB2bDb } from '../clientes/cliente-b2b';
import {
  entregaAtrasada,
  ESTADOS_B2B_ACTIVOS,
  estadoB2bVisible,
} from '../pedidos-b2b/pedidos-b2b-estados';
import { diaDeFecha } from '../pedidos-b2b/pedidos-b2b-orden';
import { CreateClienteB2bDto } from './dto/create-cliente-b2b.dto';
import { UpdateClienteB2bDto } from './dto/update-cliente-b2b.dto';
import { ListClientesB2bQueryDto } from './dto/list-clientes-b2b-query.dto';
import { ListPedidosClienteB2bQueryDto } from './dto/list-pedidos-cliente-b2b-query.dto';
import {
  TelefonoClienteB2bDto,
  UpdateTelefonoClienteB2bDto,
} from './dto/telefono-cliente-b2b.dto';

type Tx = Prisma.TransactionClient;

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

/**
 * Clientes B2B (Cliente con canal = B2B): alta solo por admin, teléfonos autorizados con un principal, baja lógica.
 * Todo pasa por TenantPrismaService (filtra por tenant); un id de otro tenant responde 404, igual que uno inexistente.
 *
 * Invariantes de teléfonos (siempre ≥ 1 y exactamente 1 principal) se mantienen dentro de una transacción con
 * FOR UPDATE sobre el cliente; el índice único parcial de la base es la red de seguridad.
 */
@Injectable()
export class ClientesB2bService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
  ) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  // ---- Lectura -----------------------------------------------------------------------------------------

  async selector() {
    const clientes = await this.db.cliente.findMany({
      where: { canal: ClienteCanal.B2B, bajaAt: null },
      orderBy: { nombre: 'asc' },
      select: {
        id: true,
        nombre: true,
        codigo: true,
        descuentoPorcentaje: true,
      },
    });
    return clientes.map((c) => ({
      ...c,
      descuentoPorcentaje: num(c.descuentoPorcentaje),
    }));
  }

  async findAll(query: ListClientesB2bQueryDto) {
    const q = query.q?.trim();
    const digits = q ? q.replace(/\D/g, '') : '';
    const where: Prisma.ClienteWhereInput = {
      canal: ClienteCanal.B2B,
      ...(query.estado === 'ACTIVOS'
        ? { bajaAt: null }
        : query.estado === 'BAJA'
          ? { bajaAt: { not: null } }
          : {}),
      ...(q
        ? {
            OR: [
              { nombre: { contains: q, mode: 'insensitive' } },
              ...(digits
                ? [{ telefonos: { some: { telefono: { contains: digits } } } }]
                : []),
            ],
          }
        : {}),
    };

    const [clientes, total] = await Promise.all([
      this.db.cliente.findMany({
        where,
        orderBy: { nombre: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { telefonos: { where: { principal: true }, take: 1 } },
      }),
      this.db.cliente.count({ where }),
    ]);

    const activos = await this.pedidosActivosPorCliente(
      clientes.map((c) => c.id),
    );
    return {
      data: clientes.map((c) => ({
        id: c.id,
        codigo: c.codigo,
        nombre: c.nombre,
        direccion: c.direccion,
        descuentoPorcentaje: num(c.descuentoPorcentaje),
        modalidadPago: c.modalidadPago,
        activo: c.bajaAt === null,
        bajaAt: c.bajaAt,
        telefonoPrincipal: c.telefonos[0]?.telefono ?? null,
        nombreContactoPrincipal: c.telefonos[0]?.nombreContacto ?? null,
        pedidosActivos: activos.get(c.id) ?? 0,
        incompleto: !c.direccion?.trim(),
        createdAt: c.createdAt,
      })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async findOne(id: string) {
    const c = await this.db.cliente.findFirst({
      where: { id, canal: ClienteCanal.B2B },
      include: {
        telefonos: { orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }] },
      },
    });
    if (!c) throw new NotFoundException('Cliente no encontrado');
    const activos = await this.pedidosActivosPorCliente([c.id]);
    return {
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      direccion: c.direccion,
      descuentoPorcentaje: num(c.descuentoPorcentaje),
      modalidadPago: c.modalidadPago,
      activo: c.bajaAt === null,
      bajaAt: c.bajaAt,
      pedidosActivos: activos.get(c.id) ?? 0,
      incompleto: !c.direccion?.trim(),
      totalPedidos: c.totalPedidos,
      ultimoPedidoAt: c.totalPedidos > 0 ? c.ultimoPedidoAt : null,
      createdAt: c.createdAt,
      telefonos: c.telefonos.map((t) => ({
        id: t.id,
        telefono: t.telefono,
        principal: t.principal,
        nombreContacto: t.nombreContacto,
      })),
    };
  }

  /**
   * Historial de pedidos del cliente (solo lectura, panel lateral del cliente): TODOS sus pedidos B2B, cancelados y
   * completados incluidos, en cualquier estado de pago. Lista ligera: sin ítems ni entregas (se piden aparte por
   * pedido). Semana más reciente primero; createdAt e id desempatan para que la paginación sea estable. Un cliente de
   * baja se consulta igual. No usa la relación legada Cliente.pedidosB2b.
   */
  async pedidosDelCliente(id: string, query: ListPedidosClienteB2bQueryDto) {
    await this.assertClienteB2b(id);
    const where: Prisma.OrderWhereInput = {
      clienteId: id,
      tipo: TipoOrden.B2B,
    };
    const [pedidos, total] = await Promise.all([
      this.db.order.findMany({
        where,
        orderBy: [
          { detalleB2b: { semanaInicio: 'desc' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          folio: true,
          estadoPedido: true,
          estadoPago: true,
          cancelado: true,
          canceladoAt: true,
          total: true,
          createdAt: true,
          detalleB2b: { select: { semanaInicio: true, totalPiezas: true } },
        },
      }),
      this.db.order.count({ where }),
    ]);
    return {
      data: pedidos.map((p) => ({
        id: p.id,
        folio: p.folio,
        semanaInicio: p.detalleB2b?.semanaInicio ?? null,
        // DESPACHADO heredado se ve como COMPLETADO; "Cancelado" lo da `cancelado`, no este campo.
        estado: estadoB2bVisible(p.estadoPedido),
        estadoPago: p.estadoPago,
        cancelado: p.cancelado,
        canceladoAt: p.canceladoAt,
        totalPiezas: p.detalleB2b?.totalPiezas ?? 0,
        total: p.total,
        createdAt: p.createdAt,
      })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  /**
   * Entregas de UN pedido del cliente (solo lectura): fecha, día, estado, atrasada y productos con su cantidad en esa
   * entrega, con el precio unitario del pedido (para el importe por línea), sin nota/hora/destino. 404 si el pedido no es de este cliente (o de otro negocio / no B2B).
   */
  async entregasDePedidoDelCliente(id: string, pedidoId: string) {
    await this.assertClienteB2b(id);
    const pedido = await this.db.order.findFirst({
      where: { id: pedidoId, clienteId: id, tipo: TipoOrden.B2B },
      select: {
        detalleB2b: { select: { semanaInicio: true } },
        entregas: {
          orderBy: { fecha: 'asc' },
          select: {
            id: true,
            fecha: true,
            estado: true,
            estadoCambiadoAt: true,
            items: {
              orderBy: { orderItem: { orden: 'asc' } },
              select: {
                cantidad: true,
                orderItem: { select: { nombreProducto: true, precioUnitario: true } },
              },
            },
          },
        },
      },
    });
    if (!pedido || !pedido.detalleB2b) {
      throw new NotFoundException('Pedido no encontrado');
    }
    const semanaInicio = pedido.detalleB2b.semanaInicio;
    return {
      entregas: pedido.entregas.map((e) => ({
        id: e.id,
        fecha: e.fecha,
        dia: diaDeFecha(e.fecha, semanaInicio),
        estado: e.estado,
        cerradaAt:
          e.estado === EstadoEntrega.ENTREGADA ||
          e.estado === EstadoEntrega.NO_RECOGIDA
            ? e.estadoCambiadoAt
            : null,
        atrasada: entregaAtrasada(e.estado, e.fecha),
        productos: e.items.map((i) => ({
          nombreProducto: i.orderItem.nombreProducto,
          // Precio de lista del pedido (snapshot) para mostrar el importe de la línea; el descuento va solo en los totales.
          precioUnitario: i.orderItem.precioUnitario,
          cantidad: i.cantidad,
        })),
      })),
    };
  }

  /** 404 si el cliente no existe, es de otro negocio o no es B2B (igual que findOne). */
  private async assertClienteB2b(id: string) {
    const c = await this.db.cliente.findFirst({
      where: { id, canal: ClienteCanal.B2B },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Cliente no encontrado');
  }

  /** Pedidos B2B no cancelados en Por confirmar / Confirmado / En proceso, por cliente. */
  private async pedidosActivosPorCliente(ids: string[]) {
    if (ids.length === 0) return new Map<string, number>();
    const filas = await this.db.order.groupBy({
      by: ['clienteId'],
      where: {
        tipo: TipoOrden.B2B,
        cancelado: false,
        estadoPedido: { in: ESTADOS_B2B_ACTIVOS },
        clienteId: { in: ids },
      },
      _count: { _all: true },
    });
    return new Map(filas.map((f) => [f.clienteId, f._count._all]));
  }

  // ---- Alta y edición ----------------------------------------------------------------------------------

  async config(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { pedidoB2bModoCobro: true },
    });
    return { modalidadCobroNegocio: t.pedidoB2bModoCobro };
  }

  async create(tenantId: string, dto: CreateClienteB2bDto) {
    // Tenant no es un modelo tenant-owned: se lee con PrismaService (el id viene de la sesión).
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { id: true, slug: true },
    });
    try {
      const cliente = await this.db.$transaction((tx) =>
        crearClienteB2b(tx as unknown as ClienteB2bDb, {
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          sufijo: dto.sufijo,
          nombre: dto.nombre,
          direccion: dto.direccion,
          descuentoPorcentaje: dto.descuentoPorcentaje,
          modalidadPago: dto.modalidadPago,
          telefonos: dto.telefonos,
        }),
      );
      return this.findOne(cliente.id);
    } catch (error) {
      // Carrera de dos altas con el mismo código: el unique [tenantId, codigo] rechaza la segunda.
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException(
          dto.sufijo
            ? `Ya existe un cliente con el código ${tenant.slug}-${dto.sufijo}`
            : 'Se estaba creando otro cliente con el mismo nombre; intenta de nuevo',
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateClienteB2bDto) {
    await this.assertExiste(id);
    const data: Prisma.ClienteUpdateInput = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre.trim();
    if (dto.direccion !== undefined) data.direccion = dto.direccion.trim();
    if (dto.descuentoPorcentaje !== undefined) {
      data.descuentoPorcentaje =
        dto.descuentoPorcentaje && dto.descuentoPorcentaje > 0
          ? dto.descuentoPorcentaje
          : null;
    }
    if (dto.modalidadPago !== undefined) data.modalidadPago = dto.modalidadPago;
    if (Object.keys(data).length > 0) {
      await this.db.cliente.update({ where: { id }, data });
    }
    return this.findOne(id);
  }

  async baja(id: string) {
    const c = await this.assertExiste(id);
    if (c.bajaAt)
      throw new ConflictException('El cliente ya está dado de baja');
    await this.db.cliente.update({
      where: { id },
      data: { bajaAt: new Date() },
    });
    return this.findOne(id);
  }

  async reactivar(id: string) {
    const c = await this.assertExiste(id);
    if (!c.bajaAt) throw new ConflictException('El cliente ya está activo');
    await this.db.cliente.update({ where: { id }, data: { bajaAt: null } });
    return this.findOne(id);
  }

  // ---- Teléfonos ---------------------------------------------------------------------------------------

  async agregarTelefono(id: string, dto: TelefonoClienteB2bDto) {
    const telefono = this.normalizar(dto.telefono);
    await this.enCliente(id, async (tx, tenantId) => {
      await this.assertTelefonoLibre(tx, id, telefono);
      if (dto.principal)
        await tx.clienteTelefono.updateMany({
          where: { clienteId: id },
          data: { principal: false },
        });
      await tx.clienteTelefono.create({
        data: {
          tenantId,
          clienteId: id,
          telefono,
          principal: !!dto.principal,
          nombreContacto: dto.nombreContacto?.trim() || null,
        },
      });
    });
    return this.findOne(id);
  }

  async editarTelefono(
    id: string,
    telefonoId: string,
    dto: UpdateTelefonoClienteB2bDto,
  ) {
    await this.enCliente(id, async (tx) => {
      const actual = await this.telefonoDe(tx, id, telefonoId);
      const data: Prisma.ClienteTelefonoUpdateInput = {};
      if (dto.telefono !== undefined) {
        const nuevo = this.normalizar(dto.telefono);
        if (nuevo !== actual.telefono) {
          await this.assertTelefonoLibre(tx, id, nuevo);
          data.telefono = nuevo;
        }
      }
      if (dto.nombreContacto !== undefined)
        data.nombreContacto = dto.nombreContacto?.trim() || null;
      if (Object.keys(data).length > 0)
        await tx.clienteTelefono.update({ where: { id: telefonoId }, data });
    });
    return this.findOne(id);
  }

  async cambiarPrincipal(id: string, telefonoId: string) {
    await this.enCliente(id, async (tx) => {
      await this.telefonoDe(tx, id, telefonoId);
      // Primero se desmarca el actual: el índice único parcial no admite dos principales ni un instante.
      await tx.clienteTelefono.updateMany({
        where: { clienteId: id, principal: true },
        data: { principal: false },
      });
      await tx.clienteTelefono.update({
        where: { id: telefonoId },
        data: { principal: true },
      });
    });
    return this.findOne(id);
  }

  async quitarTelefono(id: string, telefonoId: string) {
    await this.enCliente(id, async (tx) => {
      const t = await this.telefonoDe(tx, id, telefonoId);
      const total = await tx.clienteTelefono.count({
        where: { clienteId: id },
      });
      if (total <= 1) {
        throw new ConflictException(
          'El cliente necesita al menos un teléfono autorizado',
        );
      }
      if (t.principal) {
        throw new ConflictException(
          'Es el teléfono principal: nombra otro como principal antes de quitarlo',
        );
      }
      await tx.clienteTelefono.delete({ where: { id: telefonoId } });
    });
    return this.findOne(id);
  }

  // ---- Helpers -----------------------------------------------------------------------------------------

  private async assertExiste(id: string) {
    const c = await this.db.cliente.findFirst({
      where: { id, canal: ClienteCanal.B2B },
    });
    if (!c) throw new NotFoundException('Cliente no encontrado');
    return c;
  }

  /** Corre `fn` en una transacción con el cliente bloqueado (FOR UPDATE), tras comprobar que es de este tenant (404 si no). */
  private async enCliente(
    id: string,
    fn: (tx: Tx, tenantId: string) => Promise<void>,
  ) {
    const c = await this.assertExiste(id);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${id} FOR UPDATE`;
      await fn(tx, c.tenantId);
    });
  }

  private normalizar(crudo: string) {
    const telefono = normalizarTelefono(crudo);
    if (telefono.length < 10)
      throw new BadRequestException('El teléfono debe tener 10 dígitos');
    return telefono;
  }

  private async assertTelefonoLibre(
    tx: Tx,
    clienteId: string,
    telefono: string,
  ) {
    const ya = await tx.clienteTelefono.findFirst({
      where: { clienteId, telefono },
    });
    if (ya)
      throw new ConflictException(
        'Ese teléfono ya está registrado en este cliente',
      );
  }

  private async telefonoDe(tx: Tx, clienteId: string, telefonoId: string) {
    const t = await tx.clienteTelefono.findFirst({
      where: { id: telefonoId, clienteId },
    });
    if (!t) throw new NotFoundException('Teléfono no encontrado');
    return t;
  }
}
