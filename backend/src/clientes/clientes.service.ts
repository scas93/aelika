import { Injectable } from '@nestjs/common';
import { Cliente, ClienteCanal, Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { normalizarTelefono } from '../common/telefono';
import { ListClientesQueryDto } from './dto/list-clientes-query.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';

interface SincronizarClienteInput {
  tenantId: string;
  canal: ClienteCanal;
  telefono: string;
  nombre: string;
  correo?: string | null;
  fechaPedido: Date;
}

/**
 * Mantiene la entidad Cliente sincronizada cada vez que se crea un pedido
 * (Order o PedidoB2b) — ver los 3 call sites en PublicService.createOrder,
 * PublicPedidosB2bService.createPedido y PedidosB2bService.create. Siempre
 * se llama dentro de la misma transacción que crea el pedido (recibe `tx`,
 * nunca el cliente Prisma raíz) para que ambos se confirmen o reviertan
 * juntos — no es una notificación best-effort, es parte de los datos del
 * pedido.
 *
 * Desde Módulo 2, `sincronizarDesdePedido` se llama ANTES de crear el
 * Order/PedidoB2b (no después, como en Módulo 1 Etapa 1) — clienteId es una
 * FK requerida en ambos modelos, así que el Cliente tiene que existir
 * primero. El método devuelve el Cliente resuelto (creado o actualizado)
 * precisamente para eso: el caller usa `cliente.id` como `clienteId` al
 * crear el pedido, en la misma transacción.
 */
@Injectable()
export class ClientesService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  /**
   * Directorio de clientes del tenant en sesión — filtro de tenant ya lo
   * pone TenantPrismaService (cliente está registrado ahí, ver
   * tenant-prisma.service.ts). `q` busca por nombre (contains insensitive) o
   * teléfono: se le quita todo lo que no sea dígito y se compara contra
   * `telefono` (que ya se guarda normalizado, solo dígitos — ver
   * normalizarTelefono), así que "55 1234" o "55-1234" encuentran al mismo
   * cliente que "5512345678". Si `q` no trae ningún dígito, la mitad de
   * teléfono del OR simplemente no se agrega (buscar "" en `contains` haría
   * match con todo).
   */
  async findAll(query: ListClientesQueryDto) {
    const q = query.q?.trim();
    const digits = q ? q.replace(/\D/g, '') : '';
    const where: Prisma.ClienteWhereInput = q
      ? {
          OR: [
            { nombre: { contains: q, mode: 'insensitive' } },
            ...(digits ? [{ telefono: { contains: digits } }] : []),
          ],
        }
      : {};

    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.cliente.findMany({
        where,
        orderBy: { [query.ordenarPor]: query.orden },
        skip,
        take: query.limit,
      }),
      this.tenantPrisma.client.cliente.count({ where }),
    ]);

    return {
      data,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  // Etapa 1 (Módulo 4 / Dashboard) — clientes nuevos vs. recurrentes por
  // día, sobre la misma ventana de 10 días que OrdersService.summaryDaily
  // (mismo patrón: una sola query de la ventana completa, agrupada en
  // memoria por día — ver ese método para el razonamiento de por qué no
  // usa groupBy aquí). "Nuevo" en el día D = su primerPedidoAt cae en D;
  // "recurrente" = tuvo un pedido en D pero primerPedidoAt es de un día
  // anterior. Cuenta clientes distintos por día, no pedidos — dos pedidos
  // del mismo cliente el mismo día cuentan una sola vez, así que esta
  // serie diverge a propósito de la de OrdersService.summaryDaily.
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

    const orders = await this.tenantPrisma.client.order.findMany({
      where: { createdAt: { gte: dias[0].desde, lte: hastaHoy } },
      select: { createdAt: true, clienteId: true },
    });

    const clienteIds = [...new Set(orders.map((o) => o.clienteId))];
    const clientes = await this.tenantPrisma.client.cliente.findMany({
      where: { id: { in: clienteIds } },
      select: { id: true, primerPedidoAt: true },
    });
    const primerPedidoPorCliente = new Map(
      clientes.map((c) => [c.id, c.primerPedidoAt]),
    );

    return dias.map(({ fecha, desde, hasta }) => {
      const clientesDelDia = new Set(
        orders
          .filter((o) => o.createdAt >= desde && o.createdAt <= hasta)
          .map((o) => o.clienteId),
      );

      let nuevos = 0;
      let recurrentes = 0;
      for (const clienteId of clientesDelDia) {
        const primerPedidoAt = primerPedidoPorCliente.get(clienteId);
        const esNuevo =
          !!primerPedidoAt && primerPedidoAt >= desde && primerPedidoAt <= hasta;
        if (esNuevo) {
          nuevos++;
        } else {
          recurrentes++;
        }
      }

      return { fecha, nuevos, recurrentes };
    });
  }

  // Etapa 1 (Módulo 4 / Dashboard) — clientes con al menos un pedido en una
  // ventana rodante de 7 días terminando ahora, independiente de la
  // ventana de 10 días de summaryDaily (no es un recorte de esa serie).
  // ultimoPedidoAt ya se actualiza en cada pedido nuevo del cliente (ver
  // sincronizarDesdePedido), así que "activo" se resuelve con un solo
  // count sobre Cliente — no hace falta tocar Order para esto.
  async activos() {
    const DIAS = 7;
    const desde = new Date(Date.now() - DIAS * 24 * 60 * 60 * 1000);

    const clientesActivos = await this.tenantPrisma.client.cliente.count({
      where: { ultimoPedidoAt: { gte: desde } },
    });

    return { clientesActivos };
  }

  async sincronizarDesdePedido(
    tx: Prisma.TransactionClient,
    input: SincronizarClienteInput,
  ): Promise<Cliente> {
    const telefono = normalizarTelefono(input.telefono);

    return tx.cliente.upsert({
      where: {
        tenantId_canal_telefono: {
          tenantId: input.tenantId,
          canal: input.canal,
          telefono,
        },
      },
      create: {
        tenantId: input.tenantId,
        canal: input.canal,
        telefono,
        nombre: input.nombre,
        correo: input.correo ?? null,
        primerPedidoAt: input.fechaPedido,
        ultimoPedidoAt: input.fechaPedido,
        totalPedidos: 1,
      },
      update: {
        nombre: input.nombre,
        // Solo se sobreescribe si este pedido sí trajo correo — uno que no
        // lo capturó (Order.clienteCorreo es opcional) no debe borrar un
        // correo ya conocido de un pedido anterior del mismo cliente.
        ...(input.correo ? { correo: input.correo } : {}),
        ultimoPedidoAt: input.fechaPedido,
        totalPedidos: { increment: 1 },
      },
    });
  }
}
