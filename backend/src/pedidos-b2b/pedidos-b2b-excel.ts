import ExcelJS from 'exceljs';
import { agregarHoja, fechaExcel, fechaHoraExcelMexico, libroABuffer } from '../common/xlsx';
import { round2 } from '../common/money';

/**
 * Libros de Excel (.xlsx) de las exportaciones B2B. Funciones puras sobre filas ya consultadas: todo en español (sin valores
 * técnicos), montos y cantidades numéricos, fechas como fechas. Los CSV de B2B siguen existiendo pero ya no los usa el panel.
 */

const ESTADO_PEDIDO: Record<string, string> = {
  PENDIENTE_CONFIRMACION: 'Por confirmar',
  CONFIRMADO_SURTIENDO: 'Confirmado',
  EN_PROCESO: 'En proceso',
  COMPLETADO: 'Completado',
};
const ESTADO_PAGO: Record<string, string> = { PENDIENTE: 'Pendiente', PAGADO: 'Pagado' };
const ESTADO_ENTREGA: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  LISTA: 'Lista',
  ENTREGADA: 'Entregada',
  NO_RECOGIDA: 'No recogida',
  CANCELADA: 'Cancelada',
};

export const etiquetaEstadoEntrega = (estado: string) => ESTADO_ENTREGA[estado] ?? estado;

// ---------- Pedidos (Históricos y Pedidos activos) ----------

export interface FilaPedidoExcel {
  folio: string;
  negocioNombre: string;
  semanaInicio: Date;
  createdAt: Date;
  /** Estado visible del pedido (ya sin DESPACHADO heredado). */
  estado: string;
  cancelado: boolean;
  estadoPago: string;
  pagadoAt: Date | null;
  estadosEntregas: string[];
  subtotal: number;
  descuentoPorcentaje: number;
  descuentoTotal: number;
  total: number;
}

const cuenta = (f: FilaPedidoExcel, estado: string) => f.estadosEntregas.filter((e) => e === estado).length;

export async function libroPedidos(filas: FilaPedidoExcel[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  agregarHoja<FilaPedidoExcel>(
    libro,
    'Pedidos',
    [
      { encabezado: 'Folio', tipo: 'texto', ancho: 14, valor: (f) => f.folio },
      { encabezado: 'Negocio', tipo: 'texto', ancho: 32, valor: (f) => f.negocioNombre },
      { encabezado: 'Semana (inicio)', tipo: 'fecha', ancho: 16, valor: (f) => fechaExcel(f.semanaInicio) },
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
      { encabezado: 'Fecha de creación', tipo: 'fechaHora', ancho: 20, valor: (f) => fechaHoraExcelMexico(f.createdAt) },
      { encabezado: 'Estado del pedido', tipo: 'texto', ancho: 18, valor: (f) => (f.cancelado ? 'Cancelado' : (ESTADO_PEDIDO[f.estado] ?? f.estado)) },
      { encabezado: 'Estado de pago', tipo: 'texto', ancho: 16, valor: (f) => ESTADO_PAGO[f.estadoPago] ?? f.estadoPago },
      {
        encabezado: 'Fecha de pago',
        tipo: 'fechaHora',
        ancho: 20,
        // Pagados antes de que se guardara la fecha: se sabe que están pagados, no cuándo.
        valor: (f) => (f.pagadoAt ? fechaHoraExcelMexico(f.pagadoAt) : f.estadoPago === 'PAGADO' ? 'No registrada' : null),
      },
      { encabezado: 'Entregas totales', tipo: 'entero', ancho: 16, valor: (f) => f.estadosEntregas.length },
      { encabezado: 'Entregadas', tipo: 'entero', ancho: 12, valor: (f) => cuenta(f, 'ENTREGADA') },
      { encabezado: 'No recogidas', tipo: 'entero', ancho: 14, valor: (f) => cuenta(f, 'NO_RECOGIDA') },
      { encabezado: 'Canceladas', tipo: 'entero', ancho: 12, valor: (f) => cuenta(f, 'CANCELADA') },
      { encabezado: 'Subtotal', tipo: 'moneda', ancho: 14, valor: (f) => f.subtotal },
      { encabezado: 'Descuento %', tipo: 'decimal', ancho: 13, valor: (f) => f.descuentoPorcentaje },
      { encabezado: 'Descuento $', tipo: 'moneda', ancho: 14, valor: (f) => f.descuentoTotal },
      { encabezado: 'Total', tipo: 'moneda', ancho: 14, valor: (f) => f.total },
    ],
    filas,
  );
  return libroABuffer(libro);
}

// ---------- Entregas del día ----------

export interface FilaEntregaExcel {
  fecha: Date;
  folio: string;
  negocioNombre: string;
  estadoEntrega: string;
  categoria: string;
  producto: string;
  cantidad: number;
  precioUnitario: number;
}

export interface FilaConsolidadoExcel {
  fecha: Date;
  categoria: string;
  producto: string;
  cantidadTotal: number;
  clientes: number;
}

/** Consolidado: una fila por (categoría, producto) sumando exactamente las filas de la hoja Entregas. Clientes = negocios distintos. */
export function consolidar(filas: FilaEntregaExcel[]): FilaConsolidadoExcel[] {
  const grupos = new Map<string, FilaConsolidadoExcel & { negocios: Set<string> }>();
  for (const f of filas) {
    const clave = `${f.categoria}\u0000${f.producto}`;
    const g = grupos.get(clave) ?? { fecha: f.fecha, categoria: f.categoria, producto: f.producto, cantidadTotal: 0, clientes: 0, negocios: new Set<string>() };
    g.cantidadTotal += f.cantidad;
    g.negocios.add(f.negocioNombre);
    grupos.set(clave, g);
  }
  return [...grupos.values()]
    .map(({ negocios, ...g }) => ({ ...g, clientes: negocios.size }))
    .sort((a, b) => a.categoria.localeCompare(b.categoria, 'es') || a.producto.localeCompare(b.producto, 'es'));
}

export async function libroEntregasDia(filas: FilaEntregaExcel[]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  agregarHoja<FilaEntregaExcel>(
    libro,
    'Entregas',
    [
      { encabezado: 'Fecha de entrega', tipo: 'fecha', ancho: 17, valor: (f) => f.fecha },
      { encabezado: 'Folio', tipo: 'texto', ancho: 14, valor: (f) => f.folio },
      { encabezado: 'Negocio', tipo: 'texto', ancho: 32, valor: (f) => f.negocioNombre },
      { encabezado: 'Estado de la entrega', tipo: 'texto', ancho: 20, valor: (f) => etiquetaEstadoEntrega(f.estadoEntrega) },
      { encabezado: 'Categoría', tipo: 'texto', ancho: 24, valor: (f) => f.categoria },
      { encabezado: 'Producto', tipo: 'texto', ancho: 34, valor: (f) => f.producto },
      { encabezado: 'Cantidad', tipo: 'entero', ancho: 11, valor: (f) => f.cantidad },
      { encabezado: 'Precio unitario', tipo: 'moneda', ancho: 15, valor: (f) => f.precioUnitario },
      { encabezado: 'Subtotal', tipo: 'moneda', ancho: 14, valor: (f) => round2(f.cantidad * f.precioUnitario) },
    ],
    filas,
  );
  agregarHoja<FilaConsolidadoExcel>(
    libro,
    'Consolidado',
    [
      { encabezado: 'Fecha', tipo: 'fecha', ancho: 14, valor: (f) => f.fecha },
      { encabezado: 'Categoría', tipo: 'texto', ancho: 24, valor: (f) => f.categoria },
      { encabezado: 'Producto', tipo: 'texto', ancho: 34, valor: (f) => f.producto },
      { encabezado: 'Cantidad total', tipo: 'entero', ancho: 16, valor: (f) => f.cantidadTotal },
      { encabezado: 'Clientes', tipo: 'entero', ancho: 11, valor: (f) => f.clientes },
    ],
    consolidar(filas),
  );
  return libroABuffer(libro);
}
