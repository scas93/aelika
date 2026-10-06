import { ClienteCanal, EstadoPago, Prisma, TipoOrden } from '../../generated/prisma/client';

/** Lo mínimo que necesita el recálculo: sirve el cliente Prisma raíz, una transacción o el de tenant (con cast). */
export type ClienteContadoresDb = Pick<Prisma.TransactionClient, 'cliente' | 'order'>;

/**
 * Única fuente de verdad de `Cliente.totalPedidos` / `primerPedidoAt` / `ultimoPedidoAt`
 * — se recalculan DESDE los pedidos del cliente, nunca con incrementos sueltos:
 *
 *  - Canal B2C: cuentan los `Order` con `estadoPago = PAGADO`. Un TARJETA
 *    PENDIENTE/PROCESANDO/FALLIDO es un intento de pago, no un pedido, y un
 *    REEMBOLSADO deja de contar (el cliente pierde esa visita).
 *  - Canal B2B: cuentan las `Order` de tipo B2B con `cancelado = false`, sin importar
 *    `estadoPago` (un pedido B2B es real desde que nace; en AL_FINAL se cobra
 *    después de surtir). Desde la Etapa 2 viven en Order (antes, PedidoB2b).
 *  - Fechas = `createdAt` del pedido (no la fecha de pago). Consecuencia
 *    declarada: un pedido creado a las 23:58 y pagado a las 00:03 cuenta en el
 *    día en que se creó.
 *  - Sin pedidos contables: totalPedidos = 0 y ambas fechas = fecha de alta del
 *    Cliente (`createdAt`) — las columnas son NOT NULL, y es lo mismo que ya
 *    hace el alta por Lealtad.
 *
 * Idempotente: correrlo N veces deja el mismo resultado. Se llama al crear un
 * pedido que ya cuenta, al confirmarse el pago (webhook), al reembolsar y al
 * cancelar/marcar pagado un pedido B2B. Dos recálculos exactamente simultáneos
 * podrían pisarse (lectura y escritura no son atómicas); el siguiente recálculo
 * o el script de corrección de datos lo repara.
 */
export interface ContadoresCliente {
  totalPedidos: number;
  primerPedidoAt: Date;
  ultimoPedidoAt: Date;
}

/**
 * Calcula (sin escribir) los contadores que le corresponden al cliente según sus pedidos
 * contables. `recalcularContadoresCliente` los escribe; el script de corrección
 * (`scripts/corregir-contadores.ts`) usa este mismo cálculo para el dry-run y la verificación.
 * Devuelve `null` si el cliente no existe.
 */
export async function calcularContadoresCliente(db: ClienteContadoresDb, clienteId: string): Promise<ContadoresCliente | null> {
  const cliente = await db.cliente.findUnique({ where: { id: clienteId }, select: { canal: true, createdAt: true } });
  if (!cliente) return null;

  const agregado =
    cliente.canal === ClienteCanal.B2B
      ? await db.order.aggregate({
          where: { clienteId, tipo: TipoOrden.B2B, cancelado: false },
          _count: true,
          _min: { createdAt: true },
          _max: { createdAt: true },
        })
      : await db.order.aggregate({
          where: { clienteId, tipo: TipoOrden.B2C, estadoPago: EstadoPago.PAGADO },
          _count: true,
          _min: { createdAt: true },
          _max: { createdAt: true },
        });

  const total = agregado._count;
  return {
    totalPedidos: total,
    primerPedidoAt: total > 0 ? agregado._min.createdAt! : cliente.createdAt,
    ultimoPedidoAt: total > 0 ? agregado._max.createdAt! : cliente.createdAt,
  };
}

export async function recalcularContadoresCliente(db: ClienteContadoresDb, clienteId: string): Promise<void> {
  const contadores = await calcularContadoresCliente(db, clienteId);
  if (!contadores) return;
  await db.cliente.update({ where: { id: clienteId }, data: contadores });
}
