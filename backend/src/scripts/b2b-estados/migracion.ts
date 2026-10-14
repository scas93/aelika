import {
  EstadoEntrega,
  EstadoPedido,
  Prisma,
  TipoOrden,
} from '../../../generated/prisma/client';
import { round2 } from '../../common/money';

/**
 * Migración de datos al modelo de estados B2B por entrega (docs/diseno-operacion.md):
 *   · pedido B2B DESPACHADO (no cancelado) → COMPLETADO. Sus entregas ya están ENTREGADA (despachar las marcaba así).
 *   · PENDIENTE_CONFIRMACION y CONFIRMADO_SURTIENDO se quedan igual. Los cancelados conservan su flag (y su estado previo).
 *   · TOTALES de los pedidos cancelados: ahora cuentan solo las entregas no canceladas (los cancelados antiguos tienen todas
 *     sus entregas en CANCELADA → subtotal/descuento/total quedan en 0). Es un paso aparte (`totalesCancelados`).
 * Idempotente: tras aplicar, el plan queda vacío.
 */
export type Tx = Prisma.TransactionClient;

export interface Cambio {
  id: string;
  tenantId: string;
  folio: string;
  antes: {
    estadoPedido: EstadoPedido;
    subtotal: string;
    descuentoTotal: string;
    total: string;
  };
  despues: {
    estadoPedido: EstadoPedido;
    subtotal: string;
    descuentoTotal: string;
    total: string;
  };
  tipoCambio: 'ESTADO' | 'TOTALES_CANCELADO';
}

export interface Plan {
  porEstado: {
    slug: string;
    estadoPedido: EstadoPedido;
    cancelado: boolean;
    pedidos: number;
  }[];
  cambios: Cambio[];
  /** DESPACHADO no cancelado con alguna entrega que no está ENTREGADA (se deja COMPLETADO igualmente y se reporta). */
  dudosos: { id: string; folio: string; entregas: Record<string, number> }[];
  /** Pedidos NO cancelados cuyo total guardado difiere del calculado desde sus entregas (informativo; no se toca). */
  totalesNoCoinciden: {
    id: string;
    folio: string;
    guardado: string;
    calculado: string;
  }[];
  /** Cancelados con alguna entrega cerrada (no debería haber: antes cancelar solo se permitía sin despachar). */
  canceladosConEntregasCerradas: { id: string; folio: string }[];
}

const fmt = (n: number | Prisma.Decimal) => Number(n).toFixed(2);

export async function planificar(
  tx: Tx,
  o: { tenantId?: string } = {},
): Promise<Plan> {
  const where: Prisma.OrderWhereInput = {
    tipo: TipoOrden.B2B,
    ...(o.tenantId ? { tenantId: o.tenantId } : {}),
  };
  const ordenes = await tx.order.findMany({
    where,
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      tenantId: true,
      folio: true,
      estadoPedido: true,
      cancelado: true,
      descuentoTotal: true,
      total: true,
      tenant: { select: { slug: true } },
      detalleB2b: {
        select: { subtotal: true, descuentoPorcentajeAplicado: true },
      },
      entregas: {
        select: {
          estado: true,
          items: {
            select: {
              cantidad: true,
              orderItem: { select: { precioUnitario: true } },
            },
          },
        },
      },
    },
  });

  const conteo = new Map<
    string,
    {
      slug: string;
      estadoPedido: EstadoPedido;
      cancelado: boolean;
      pedidos: number;
    }
  >();
  const cambios: Cambio[] = [];
  const dudosos: Plan['dudosos'] = [];
  const totalesNoCoinciden: Plan['totalesNoCoinciden'] = [];
  const canceladosConEntregasCerradas: Plan['canceladosConEntregasCerradas'] =
    [];

  for (const orden of ordenes) {
    const llave = `${orden.tenant.slug}|${orden.estadoPedido}|${orden.cancelado}`;
    const c = conteo.get(llave) ?? {
      slug: orden.tenant.slug,
      estadoPedido: orden.estadoPedido,
      cancelado: orden.cancelado,
      pedidos: 0,
    };
    c.pedidos += 1;
    conteo.set(llave, c);

    const d = orden.detalleB2b;
    if (!d) continue;
    const pct = d.descuentoPorcentajeAplicado
      ? Number(d.descuentoPorcentajeAplicado)
      : 0;
    const subtotalVigente = round2(
      orden.entregas
        .filter((e) => e.estado !== EstadoEntrega.CANCELADA)
        .reduce(
          (s, e) =>
            s +
            e.items.reduce(
              (si, i) => si + Number(i.orderItem.precioUnitario) * i.cantidad,
              0,
            ),
          0,
        ),
    );
    const descuentoVigente = round2(subtotalVigente * (pct / 100));
    const totalVigente = round2(subtotalVigente - descuentoVigente);

    const antes = {
      estadoPedido: orden.estadoPedido,
      subtotal: fmt(d.subtotal),
      descuentoTotal: fmt(orden.descuentoTotal),
      total: fmt(orden.total),
    };

    if (orden.cancelado) {
      if (
        orden.entregas.some(
          (e) =>
            e.estado === EstadoEntrega.ENTREGADA ||
            e.estado === EstadoEntrega.NO_RECOGIDA,
        )
      ) {
        canceladosConEntregasCerradas.push({
          id: orden.id,
          folio: orden.folio,
        });
      }
      const despues = {
        ...antes,
        subtotal: fmt(subtotalVigente),
        descuentoTotal: fmt(descuentoVigente),
        total: fmt(totalVigente),
      };
      if (
        despues.subtotal !== antes.subtotal ||
        despues.descuentoTotal !== antes.descuentoTotal ||
        despues.total !== antes.total
      ) {
        cambios.push({
          id: orden.id,
          tenantId: orden.tenantId,
          folio: orden.folio,
          antes,
          despues,
          tipoCambio: 'TOTALES_CANCELADO',
        });
      }
      continue;
    }

    if (fmt(totalVigente) !== antes.total)
      totalesNoCoinciden.push({
        id: orden.id,
        folio: orden.folio,
        guardado: antes.total,
        calculado: fmt(totalVigente),
      });

    if (orden.estadoPedido === EstadoPedido.DESPACHADO) {
      const porEstado: Record<string, number> = {};
      for (const e of orden.entregas)
        porEstado[e.estado] = (porEstado[e.estado] ?? 0) + 1;
      if (orden.entregas.some((e) => e.estado !== EstadoEntrega.ENTREGADA))
        dudosos.push({ id: orden.id, folio: orden.folio, entregas: porEstado });
      cambios.push({
        id: orden.id,
        tenantId: orden.tenantId,
        folio: orden.folio,
        antes,
        despues: { ...antes, estadoPedido: EstadoPedido.COMPLETADO },
        tipoCambio: 'ESTADO',
      });
    }
  }

  return {
    porEstado: [...conteo.values()],
    cambios,
    dudosos,
    totalesNoCoinciden,
    canceladosConEntregasCerradas,
  };
}

export interface Opciones {
  tenantId?: string;
  /** Aplica también el recálculo de totales de los cancelados (paso aparte, sujeto a OK). */
  totalesCancelados: boolean;
}

/** Aplica el plan en `tx` y verifica releyendo. Devuelve lo aplicado. */
export async function aplicar(tx: Tx, plan: Plan, op: Opciones) {
  const aplicables = plan.cambios.filter(
    (c) => c.tipoCambio === 'ESTADO' || op.totalesCancelados,
  );
  for (const c of aplicables) {
    if (c.tipoCambio === 'ESTADO') {
      await tx.order.update({
        where: { id: c.id },
        data: { estadoPedido: c.despues.estadoPedido },
      });
    } else {
      await tx.detalleB2B.update({
        where: { orderId: c.id },
        data: { subtotal: c.despues.subtotal },
      });
      await tx.order.update({
        where: { id: c.id },
        data: {
          descuentoTotal: c.despues.descuentoTotal,
          total: c.despues.total,
        },
      });
    }
  }
  // Verificación: lo que se aplicó es exactamente lo planeado.
  for (const c of aplicables) {
    const o = await tx.order.findUniqueOrThrow({
      where: { id: c.id },
      select: {
        estadoPedido: true,
        descuentoTotal: true,
        total: true,
        detalleB2b: { select: { subtotal: true } },
      },
    });
    const ok =
      o.estadoPedido === c.despues.estadoPedido &&
      fmt(o.total) === c.despues.total &&
      fmt(o.descuentoTotal) === c.despues.descuentoTotal &&
      fmt(o.detalleB2b!.subtotal) === c.despues.subtotal;
    if (!ok)
      throw new Error(
        `Verificación fallida en ${c.folio} (${c.id.slice(0, 8)}): no coincide con lo planeado — rollback`,
      );
  }
  return {
    aplicados: aplicables.length,
    estados: aplicables.filter((c) => c.tipoCambio === 'ESTADO').length,
    totales: aplicables.filter((c) => c.tipoCambio === 'TOTALES_CANCELADO')
      .length,
  };
}

/** Restaura estado/totales desde el respaldo (cambios aplicados). Se niega si el pedido cambió después, salvo `forzar`. */
export async function revertir(tx: Tx, respaldo: Cambio[], forzar: boolean) {
  let restaurados = 0;
  for (const c of respaldo) {
    const o = await tx.order.findUnique({
      where: { id: c.id },
      select: { estadoPedido: true, total: true },
    });
    if (!o) continue;
    const sigueIgual =
      o.estadoPedido === c.despues.estadoPedido &&
      fmt(o.total) === c.despues.total;
    if (!sigueIgual && !forzar)
      throw new Error(
        `El pedido ${c.folio} cambió después de la migración; usa --forzar para revertirlo igualmente`,
      );
    await tx.order.update({
      where: { id: c.id },
      data: {
        estadoPedido: c.antes.estadoPedido,
        descuentoTotal: c.antes.descuentoTotal,
        total: c.antes.total,
      },
    });
    await tx.detalleB2B.update({
      where: { orderId: c.id },
      data: { subtotal: c.antes.subtotal },
    });
    restaurados += 1;
  }
  return { restaurados };
}
