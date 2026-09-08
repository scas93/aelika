import { Injectable } from '@nestjs/common';
import { ClienteCanal, Prisma } from '../../generated/prisma/client';
import { normalizarTelefono } from '../common/telefono';

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
 */
@Injectable()
export class ClientesService {
  async sincronizarDesdePedido(
    tx: Prisma.TransactionClient,
    input: SincronizarClienteInput,
  ): Promise<void> {
    const telefono = normalizarTelefono(input.telefono);

    await tx.cliente.upsert({
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
