import { ClienteCanal, Prisma } from '../../generated/prisma/client';

/**
 * Alta/búsqueda del Cliente de una reserva de hotel (canal B2C, llave tenant + teléfono). Función propia —no
 * `sincronizarDesdePedido`— para no tocar el flujo B2C. Segura ante altas simultáneas con el mismo teléfono: `createMany`
 * con `skipDuplicates` es INSERT … ON CONFLICT DO NOTHING (no aborta la transacción como lo haría un P2002).
 * `creado = false` significa que ya existía; el llamador decide si actualiza su nombre/correo.
 */
export async function buscarOCrearClienteReserva(
  tx: Prisma.TransactionClient,
  p: { tenantId: string; telefono: string; nombre: string; correo: string | null },
) {
  const ahora = new Date();
  const { count } = await tx.cliente.createMany({
    data: [
      {
        tenantId: p.tenantId,
        canal: ClienteCanal.B2C,
        telefono: p.telefono,
        nombre: p.nombre,
        correo: p.correo,
        // Sin pedidos contables todavía: el llamador recalcula los contadores.
        primerPedidoAt: ahora,
        ultimoPedidoAt: ahora,
        totalPedidos: 0,
      },
    ],
    skipDuplicates: true,
  });
  const cliente = await tx.cliente.findUniqueOrThrow({
    where: { tenantId_canal_telefono: { tenantId: p.tenantId, canal: ClienteCanal.B2C, telefono: p.telefono } },
  });
  return { cliente, creado: count === 1 };
}

/** Bloquea las filas de Cliente (orden estable por id, sin deadlocks entre reservas que cambian de cliente). */
export async function bloquearClientes(tx: Prisma.TransactionClient, ids: string[]) {
  const unicos = [...new Set(ids)].sort();
  if (unicos.length === 0) return;
  await tx.$queryRaw`SELECT id FROM clientes WHERE id IN (${Prisma.join(unicos)}) ORDER BY id FOR UPDATE`;
}
