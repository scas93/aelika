import {
  libroPedidos,
  repartirDescuento,
  type FilaEntregaPedidoExcel,
  type FilaPedidoExcel,
  type VistaExcelPedidos,
} from './pedidos-b2b-excel';
import { fechaExcel } from '../common/xlsx';
import { libroPedidosAgrupado } from './pedidos-b2b-excel-agrupado';
import { round2 } from '../common/money';
import {
  EstadoEntrega,
  Prisma,
  TipoOrden,
} from '../../generated/prisma/client';
import {
  filtroImporteWhere,
  type FiltroImporteOperador,
} from '../common/filtro-importe';
import {
  entregaAtrasada,
  ESTADOS_B2B_COMPLETADOS,
  estadoB2bVisible,
  ESTADOS_ENTREGA_CERRADOS,
  estadosDeBdParaFiltro,
  ESTADOS_PAGO_B2B_FILTRO,
  type EstadoB2bFiltro,
  type EstadoPagoB2bFiltro,
} from './pedidos-b2b-estados';

/**
 * Selección de pedidos y armado del Excel de pedidos B2B, SIN dependencias de HTTP ni de sesión: el export del panel
 * (`PedidosB2bService.exportPedidosXlsx`, con `TenantPrismaService`) y el resumen semanal por correo (proceso programado, con
 * `PrismaService` y `tenantId` explícito) usan exactamente estas piezas, así que si el criterio o las columnas cambian,
 * cambian los dos.
 */

export function buildWherePedidosB2b(query: {
  estado?: EstadoB2bFiltro;
  estados?: EstadoB2bFiltro[];
  estadoPago?: EstadoPagoB2bFiltro[];
  conCancelados?: boolean;
  soloHistorico?: boolean;
  semanaAntesDe?: string;
  cancelado?: boolean;
  desde?: string;
  hasta?: string;
  negocioNombre?: string;
  operador?: FiltroImporteOperador;
  valor?: number;
  valorHasta?: number;
  /** Solo los pedidos de ESTE cliente (por id, no por nombre comercial). Lo usa el resumen semanal por cliente; el export del panel no lo manda. */
  clienteId?: string;
}): Prisma.OrderWhereInput {
  const detalle: Prisma.DetalleB2BWhereInput = {
    semanaInicio:
      query.desde || query.hasta || query.semanaAntesDe
        ? {
            gte: query.desde ? new Date(query.desde) : undefined,
            lte: query.hasta ? new Date(query.hasta) : undefined,
            // semanaInicio estrictamente anterior (pedidos activos de semanas pasadas)
            lt: query.semanaAntesDe ? new Date(query.semanaAntesDe) : undefined,
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
  const estadosSel =
    query.estados ?? (query.estado ? [query.estado] : undefined);
  const porEstado: Prisma.OrderWhereInput | undefined = estadosSel
    ? {
        // COMPLETADO también abarca el DESPACHADO heredado (antes de migrar los datos).
        estadoPedido: {
          in: [...new Set(estadosSel.flatMap(estadosDeBdParaFiltro))],
        },
      }
    : undefined;
  const y: Prisma.OrderWhereInput[] = [];
  // Estado con "Cancelado" marcado: (estados Y no cancelado) O cancelado. Si no hay estados, solo los cancelados.
  const conCancelados = query.conCancelados;
  if (conCancelados && porEstado && estadosSel!.length > 0) {
    y.push({
      OR: [{ AND: [porEstado, { cancelado: false }] }, { cancelado: true }],
    });
  }
  // Históricos: solo Completados (incluye el DESPACHADO heredado) y Cancelados.
  if (query.soloHistorico) {
    y.push({
      OR: [
        { cancelado: true },
        { estadoPedido: { in: ESTADOS_B2B_COMPLETADOS } },
      ],
    });
  }
  const combinado = conCancelados && porEstado && estadosSel!.length > 0;
  // Marcar todos los estados de pago equivale a no filtrar por pago.
  const pagos = [...new Set(query.estadoPago ?? [])];
  const filtraPago =
    pagos.length > 0 && pagos.length < ESTADOS_PAGO_B2B_FILTRO.length;
  return {
    tipo: TipoOrden.B2B,
    ...(query.clienteId ? { clienteId: query.clienteId } : {}),
    // `estados` (multi-valor) tiene prioridad si llega — ver ExportPedidosB2bQueryDto para el motivo (vista "activos" con dos
    // estatus a la vez, sin pestaña por estatus).
    estadoPedido: combinado ? undefined : porEstado?.estadoPedido,
    cancelado: combinado
      ? undefined
      : (query.cancelado ?? (conCancelados ? true : undefined)),
    estadoPago: filtraPago ? { in: pagos } : undefined,
    ...(y.length > 0 ? { AND: y } : {}),
    total: filtroImporteWhere(query.operador, query.valor, query.valorHasta),
    // Siempre hay detalle en una orden B2B; el filtro solo se agrega si realmente se filtra por él.
    ...(detalle.semanaInicio || detalle.negocioNombre
      ? { detalleB2b: detalle }
      : {}),
  };
}

/** Qué se lee de cada pedido para armar el Excel (y el resumen semanal). */
export const PEDIDOS_EXPORT_SELECT = {
  folio: true,
  estadoPedido: true,
  estadoPago: true,
  cancelado: true,
  total: true,
  descuentoTotal: true,
  createdAt: true,
  cliente: { select: { codigo: true } },
  detalleB2b: {
    select: {
      negocioNombre: true,
      semanaInicio: true,
      subtotal: true,
      descuentoPorcentajeAplicado: true,
      pagadoAt: true,
      notaCliente: true,
    },
  },
  entregas: {
    select: {
      estado: true,
      fecha: true,
      nota: true,
      estadoCambiadoAt: true,
      items: {
        select: {
          cantidad: true,
          orderItem: { select: { precioUnitario: true, nombreProducto: true } },
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;

export type PedidoExport = Prisma.OrderGetPayload<{
  select: typeof PEDIDOS_EXPORT_SELECT;
}>;

export const PEDIDOS_EXPORT_ORDEN: Prisma.OrderOrderByWithRelationInput[] = [
  { detalleB2b: { semanaInicio: 'desc' } },
  { createdAt: 'asc' },
];

/** Filas de las hojas «Pedidos» y «Entregas» (una por pedido y una por entrega no cancelada). */
export function filasExcelDePedidos(pedidos: PedidoExport[]): {
  filas: FilaPedidoExcel[];
  entregas: FilaEntregaPedidoExcel[];
} {
  const filas: FilaPedidoExcel[] = pedidos.map((o) => ({
    folio: o.folio,
    clienteCodigo: o.cliente.codigo,
    negocioNombre: o.detalleB2b!.negocioNombre,
    semanaInicio: o.detalleB2b!.semanaInicio,
    notaCliente: o.detalleB2b!.notaCliente,
    createdAt: o.createdAt,
    estado: estadoB2bVisible(o.estadoPedido),
    cancelado: o.cancelado,
    estadoPago: o.estadoPago,
    pagadoAt: o.detalleB2b!.pagadoAt,
    estadosEntregas: o.entregas.map((e) => e.estado),
    // Solo las piezas de entregas NO canceladas: cuadra con el Total del pedido (que ya excluye las canceladas) y con la suma de
    // Piezas de la hoja «Entregas». Sin entregas canceladas es el mismo número que `totalPiezas` del pedido.
    totalPiezas: o.entregas
      .filter((e) => e.estado !== EstadoEntrega.CANCELADA)
      .reduce((n, e) => n + e.items.reduce((m, i) => m + i.cantidad, 0), 0),
    subtotal: Number(o.detalleB2b!.subtotal),
    descuentoPorcentaje: Number(o.detalleB2b!.descuentoPorcentajeAplicado ?? 0),
    descuentoTotal: Number(o.descuentoTotal),
    total: Number(o.total),
  }));
  // Hoja «Entregas»: las entregas no canceladas de los mismos pedidos. Importe = precio del pedido × piezas (antes del descuento).
  const entregas: FilaEntregaPedidoExcel[] = pedidos.flatMap((o) => {
    const vivas = o.entregas
      .filter((e) => e.estado !== EstadoEntrega.CANCELADA)
      .map((e) => ({
        fecha: fechaExcel(e.fecha),
        folio: o.folio,
        clienteCodigo: o.cliente.codigo,
        negocioNombre: o.detalleB2b!.negocioNombre,
        estado: e.estado,
        atrasada: entregaAtrasada(e.estado, e.fecha),
        piezas: e.items.reduce((s, i) => s + i.cantidad, 0),
        importe: round2(
          e.items.reduce(
            (s, i) => s + i.cantidad * Number(i.orderItem.precioUnitario),
            0,
          ),
        ),
        cerradaAt: ESTADOS_ENTREGA_CERRADOS.includes(e.estado)
          ? e.estadoCambiadoAt
          : null,
        nota: e.nota,
      }));
    // Descuento del pedido repartido entre sus entregas no canceladas (solo lo muestra la hoja de Pedidos activos).
    const descuentos = repartirDescuento(Number(o.descuentoTotal), vivas);
    return vivas.map((e, n) => ({ ...e, descuento: descuentos[n] }));
  });
  return { filas, entregas };
}

export function libroDePedidosExport(
  pedidos: PedidoExport[],
  vista: VistaExcelPedidos,
): Promise<Buffer> {
  // Históricos del panel: bloques por negocio, pedido y entrega (+ tablas planas). El resumen semanal al negocio llama a
  // `libroPedidos` directamente y conserva su formato plano.
  if (vista === 'HISTORICOS') return libroPedidosAgrupado(pedidos);
  const { filas, entregas } = filasExcelDePedidos(pedidos);
  return libroPedidos(filas, entregas, vista);
}
