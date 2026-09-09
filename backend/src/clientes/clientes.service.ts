import { Injectable } from '@nestjs/common';
import { Cliente, ClienteCanal, Prisma } from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { normalizarTelefono } from '../common/telefono';
import { ListClientesQueryDto } from './dto/list-clientes-query.dto';

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
