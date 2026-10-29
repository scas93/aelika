import type { Prisma } from '../../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { Tenant } from '../../generated/prisma/client';
import { calcularCalendario, type SemanaCalendario } from './portal-calendario';
import {
  cargarDiasSinEntrega,
  cargarPedidosCalendario,
} from './portal-calendario.service';

/** Parámetros del calendario del negocio (los mismos de la 4c). */
export function parametrosDe(t: Tenant) {
  return {
    horaEntrega: t.portalHoraEntrega,
    horasAgregar: t.portalHorasAgregarDia,
    horasModificar: t.portalHorasModificar,
    horizonteSemanas: t.portalHorizonteSemanas,
  };
}

/**
 * Semana del calendario (4c) en la que cae un pedido del cliente, ya calculada con su estado real. null si la semana ya
 * no está dentro del horizonte (pasada) o el pedido no cuenta (cancelado). Sirve para leer y para revalidar DENTRO de la
 * transacción de modificar, con el cliente y el pedido bloqueados.
 */
export async function calendarioDeSemana(
  db: PrismaService | Prisma.TransactionClient,
  t: Tenant,
  clienteId: string,
  semanaISO: string,
  ahora: Date,
): Promise<SemanaCalendario | null> {
  const { porSemana } = await cargarPedidosCalendario(db, t.id, clienteId, [
    semanaISO,
  ]);
  const diasSinEntrega = await cargarDiasSinEntrega(db, t.id, semanaISO);
  return (
    calcularCalendario(ahora, parametrosDe(t), porSemana, diasSinEntrega).find(
      (s) => s.semanaInicio === semanaISO && s.pedido !== null,
    ) ?? null
  );
}

/**
 * ¿Puede el cliente cambiar algo de este pedido ahora? Pedido no pagado con al menos un día que se puede modificar o
 * agregar. Misma fuente de verdad que el calendario: nada de reglas paralelas.
 */
export function semanaModificable(s: SemanaCalendario | null): boolean {
  if (!s || !s.pedido || s.pedido.pagado) return false;
  return s.dias.some(
    (d) => d.estado === 'MODIFICABLE' || d.estado === 'AGREGABLE',
  );
}
