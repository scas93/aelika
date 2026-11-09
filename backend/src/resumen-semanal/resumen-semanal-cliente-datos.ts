import ExcelJS from 'exceljs';
import { EstadoEntrega, Prisma } from '../../generated/prisma/client';
import {
  filasExcelDePedidos,
  PEDIDOS_EXPORT_SELECT,
} from '../pedidos-b2b/pedidos-b2b-export';
import type { FilaPedidoExcel } from '../pedidos-b2b/pedidos-b2b-excel';
import {
  agregarHoja,
  type ColumnaXlsx,
  fechaExcel,
  fechaHoraExcelMexico,
  libroABuffer,
} from '../common/xlsx';

/**
 * Datos y Excel del resumen semanal que recibe CADA CLIENTE B2B (puro: sin base de datos ni red). El cliente ve solo lo que le
 * toca: pedidos, entregas y, por entrega, los productos con su monto. Nunca estado de pago ni descuento, y ningún estado
 * (Por confirmar, Atrasada, Entregada…) salvo «Cancelado»/«Cancelada» para que se entienda por qué algo no suma.
 */

/** Lo que se lee de cada pedido: lo mismo que el export del panel + id de la entrega y el producto de cada línea. */
export const PEDIDOS_RESUMEN_CLIENTE_SELECT = {
  ...PEDIDOS_EXPORT_SELECT,
  entregas: {
    orderBy: { fecha: 'asc' },
    select: {
      id: true,
      estado: true,
      fecha: true,
      nota: true,
      estadoCambiadoAt: true,
      items: {
        orderBy: { orderItem: { orden: 'asc' } },
        select: {
          cantidad: true,
          orderItem: {
            select: { precioUnitario: true, nombreProducto: true },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;

export type PedidoResumenCliente = Prisma.OrderGetPayload<{
  select: typeof PEDIDOS_RESUMEN_CLIENTE_SELECT;
}>;

/** Una línea (un producto) de una entrega, con su monto NETO: ya sin la parte del descuento que le toca. */
export interface LineaEntregaCliente {
  folio: string;
  entregaId: string;
  fecha: Date;
  producto: string;
  unidades: number;
  monto: number;
  nota: string | null;
}

/**
 * Reparte `totalCent` (el Total del pedido, en centavos) entre las líneas en proporción a su importe de lista (`brutosCent`), por
 * el método del mayor residuo: cada línea queda en centavos enteros y la suma es EXACTAMENTE `totalCent` (los centavos que sobran
 * o faltan van a las líneas con mayor residuo; en empate, a la primera). Sin importe de lista todo es 0.
 */
export function repartirTotalEnLineas(
  totalCent: number,
  brutosCent: number[],
): number[] {
  const suma = brutosCent.reduce((a, b) => a + b, 0);
  if (suma <= 0 || totalCent <= 0) return brutosCent.map(() => 0);
  const exactos = brutosCent.map((b) => (totalCent * b) / suma);
  const base = exactos.map((x) => Math.floor(x));
  let faltan = totalCent - base.reduce((a, b) => a + b, 0);
  const orden = exactos
    .map((x, i) => ({ i, resto: x - Math.floor(x) }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const { i } of orden) {
    if (faltan <= 0) break;
    base[i] += 1;
    faltan -= 1;
  }
  return base;
}

export function datosResumenCliente(pedidos: PedidoResumenCliente[]): {
  filas: FilaPedidoExcel[];
  lineas: LineaEntregaCliente[];
} {
  const { filas } = filasExcelDePedidos(pedidos);
  const lineas: LineaEntregaCliente[] = [];
  for (const o of pedidos) {
    if (o.cancelado) continue; // un pedido cancelado no suma: no lleva detalle
    const brutas: Omit<LineaEntregaCliente, 'monto'>[] = [];
    const brutosCent: number[] = [];
    for (const e of o.entregas) {
      if (e.estado === EstadoEntrega.CANCELADA) continue;
      for (const i of e.items) {
        brutas.push({
          folio: o.folio,
          entregaId: e.id,
          fecha: fechaExcel(e.fecha),
          producto: i.orderItem.nombreProducto,
          unidades: i.cantidad,
          nota: e.nota,
        });
        brutosCent.push(
          Math.round(i.cantidad * Number(i.orderItem.precioUnitario) * 100),
        );
      }
    }
    // El Total del pedido ya es el del correo; las líneas lo reparten sin mostrar el descuento.
    const netos = repartirTotalEnLineas(
      Math.round(Number(o.total) * 100),
      brutosCent,
    );
    brutas.forEach((l, n) => lineas.push({ ...l, monto: netos[n] / 100 }));
  }
  return { filas, lineas };
}

// ---------- Excel ----------

const DIA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const COL_PEDIDOS: ColumnaXlsx<FilaPedidoExcel>[] = [
  { encabezado: 'Negocio', tipo: 'texto', ancho: 32, valor: (f) => f.negocioNombre },
  {
    encabezado: 'Semana (inicio)',
    tipo: 'fecha',
    ancho: 16,
    valor: (f) => fechaExcel(f.semanaInicio),
  },
  {
    encabezado: 'Semana (fin)',
    tipo: 'fecha',
    ancho: 14,
    valor: (f) => {
      const fin = fechaExcel(f.semanaInicio);
      fin.setUTCDate(fin.getUTCDate() + 6);
      return fin;
    },
  },
  {
    encabezado: 'Fecha de creación',
    tipo: 'fechaHora',
    ancho: 20,
    valor: (f) => fechaHoraExcelMexico(f.createdAt),
  },
  {
    encabezado: 'Entregas totales',
    tipo: 'entero',
    ancho: 16,
    valor: (f) => f.estadosEntregas.length,
  },
  {
    encabezado: 'Total',
    tipo: 'moneda',
    ancho: 14,
    // Cancelado: en lugar del monto va el texto «Cancelado» (sin columna de estado; una suma de la columna solo toma lo vigente).
    valor: (f) => (f.cancelado ? 'Cancelado' : f.total),
  },
  { encabezado: 'Nota del cliente', tipo: 'texto', ancho: 40, valor: (f) => f.notaCliente },
];

const COL_ENTREGAS: ColumnaXlsx<LineaEntregaCliente>[] = [
  { encabezado: 'Fecha de entrega', tipo: 'fecha', ancho: 17, valor: (l) => l.fecha },
  { encabezado: 'Día', tipo: 'texto', ancho: 8, valor: (l) => DIA_CORTO[l.fecha.getUTCDay()] },
  { encabezado: 'Producto', tipo: 'texto', ancho: 36, valor: (l) => l.producto },
  { encabezado: 'Unidades', tipo: 'entero', ancho: 11, valor: (l) => l.unidades },
  { encabezado: 'Monto', tipo: 'moneda', ancho: 14, valor: (l) => l.monto },
  { encabezado: 'Nota de la entrega', tipo: 'texto', ancho: 40, valor: (l) => l.nota },
];

/**
 * Sin columna de folio, el orden es lo que agrupa: fecha de entrega, luego pedido (por folio, solo para ordenar; no se muestra),
 * luego entrega del mismo pedido y producto (por nombre).
 */
function ordenarLineas(lineas: LineaEntregaCliente[]): LineaEntregaCliente[] {
  return [...lineas].sort(
    (a, b) =>
      a.fecha.getTime() - b.fecha.getTime() ||
      a.folio.localeCompare(b.folio, 'es', { numeric: true }) ||
      a.producto.localeCompare(b.producto, 'es'),
  );
}

export async function libroResumenCliente(
  filas: FilaPedidoExcel[],
  lineas: LineaEntregaCliente[],
): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  agregarHoja(libro, 'Pedidos', COL_PEDIDOS, filas);
  agregarHoja(libro, 'Entregas', COL_ENTREGAS, ordenarLineas(lineas));
  return libroABuffer(libro);
}
