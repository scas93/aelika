import ExcelJS from 'exceljs';
import {
  agregarHoja,
  type ColumnaXlsx,
  fechaExcel,
  fechaHoraExcelMexico,
  libroABuffer,
} from '../common/xlsx';
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
const ESTADO_PAGO: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  PAGADO: 'Pagado',
};
const ESTADO_ENTREGA: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  LISTA: 'Lista',
  ENTREGADA: 'Entregada',
  NO_RECOGIDA: 'No recogida',
  CANCELADA: 'Cancelada',
};

export const etiquetaEstadoEntrega = (estado: string) =>
  ESTADO_ENTREGA[estado] ?? estado;

// ---------- Pedidos (Históricos y Pedidos activos) ----------

export interface FilaPedidoExcel {
  folio: string;
  /** Código del cliente (null en pedidos viejos de clientes sin código). */
  clienteCodigo: string | null;
  negocioNombre: string;
  semanaInicio: Date;
  /** Nota libre del cliente al capturar el pedido. */
  notaCliente: string | null;
  createdAt: Date;
  /** Estado visible del pedido (ya sin DESPACHADO heredado). */
  estado: string;
  cancelado: boolean;
  estadoPago: string;
  pagadoAt: Date | null;
  estadosEntregas: string[];
  /** Piezas de las entregas NO canceladas del pedido (cuadra con el Total y con la suma de Piezas de la hoja «Entregas»). */
  totalPiezas: number;
  subtotal: number;
  descuentoPorcentaje: number;
  descuentoTotal: number;
  total: number;
}

const cuenta = (f: FilaPedidoExcel, estado: string) =>
  f.estadosEntregas.filter((e) => e === estado).length;

/** Una entrega no cancelada de un pedido de la hoja «Pedidos». El importe es antes del descuento (precio del pedido × piezas). */
export interface FilaEntregaPedidoExcel {
  fecha: Date;
  folio: string;
  clienteCodigo: string | null;
  negocioNombre: string;
  /** Estado de la entrega en BD; «Atrasada» se deriva de `atrasada`. */
  estado: string;
  atrasada: boolean;
  piezas: number;
  importe: number;
  /** Parte del descuento del pedido que le toca a esta entrega (ver repartirDescuento). Solo la hoja de Pedidos activos la muestra. */
  descuento: number;
  /** Solo Entregada y No recogida. */
  cerradaAt: Date | null;
  nota: string | null;
}


/**
 * Reparte el descuento de un pedido entre sus entregas no canceladas, en proporción al importe (antes de descuento) de cada
 * una. Trabaja en centavos enteros para que la suma de lo repartido sea EXACTAMENTE `descuentoTotal`: cada parte se redondea
 * a centavos y la diferencia (de unos centavos) se le suma o resta a UNA sola entrega: la de mayor importe (si empatan, la
 * de fecha más reciente; si aún empatan, la última de la lista), que es donde menos distorsiona. Devuelve un descuento por
 * importe, en el mismo orden. Sin importe total (o sin descuento) todo es 0.
 */
export function repartirDescuento(
  descuentoTotal: number,
  importes: { importe: number; fecha: Date }[],
): number[] {
  const descCent = Math.round(descuentoTotal * 100);
  const impCent = importes.map((i) => Math.round(i.importe * 100));
  const suma = impCent.reduce((a, b) => a + b, 0);
  if (descCent === 0 || suma === 0) return importes.map(() => 0);
  const partes = impCent.map((c) => Math.round((descCent * c) / suma));
  const diferencia = descCent - partes.reduce((a, b) => a + b, 0);
  if (diferencia !== 0) {
    let elegido = 0;
    importes.forEach((i, n) => {
      const mejor = importes[elegido];
      if (
        impCent[n] > impCent[elegido] ||
        (impCent[n] === impCent[elegido] &&
          i.fecha.getTime() >= mejor.fecha.getTime())
      )
        elegido = n;
    });
    partes[elegido] += diferencia;
  }
  return partes.map((c) => c / 100);
}

/** Qué pantalla pide el Excel: Históricos conserva sus columnas de siempre; Pedidos activos tiene las suyas. */
export type VistaExcelPedidos = 'HISTORICOS' | 'ACTIVOS';

const DIA_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Fecha ascendente, luego negocio, luego folio (numérico si el folio es numérico). */
export function ordenarEntregasPedidos(
  filas: FilaEntregaPedidoExcel[],
): FilaEntregaPedidoExcel[] {
  return [...filas].sort(
    (a, b) =>
      a.fecha.getTime() - b.fecha.getTime() ||
      a.negocioNombre.localeCompare(b.negocioNombre, 'es') ||
      a.folio.localeCompare(b.folio, 'es', { numeric: true }),
  );
}

type ColumnaPedidos = ColumnaXlsx<FilaPedidoExcel>;
type ColumnaEntregaPedidos = ColumnaXlsx<FilaEntregaPedidoExcel>;

const COL_PED = {
  folio: { encabezado: 'Folio', tipo: 'texto', ancho: 14, valor: (f) => f.folio },
  codigo: {
    encabezado: 'Código del cliente',
    tipo: 'texto',
    ancho: 28,
    valor: (f) => f.clienteCodigo,
  },
  negocio: {
    encabezado: 'Negocio',
    tipo: 'texto',
    ancho: 32,
    valor: (f) => f.negocioNombre,
  },
  semanaInicio: {
    encabezado: 'Semana (inicio)',
    tipo: 'fecha',
    ancho: 16,
    valor: (f) => fechaExcel(f.semanaInicio),
  },
  semanaFin: {
    encabezado: 'Semana (fin)',
    tipo: 'fecha',
    ancho: 14,
    valor: (f) => {
      const fin = fechaExcel(f.semanaInicio);
      fin.setUTCDate(fin.getUTCDate() + 6);
      return fin;
    },
  },
  creacion: {
    encabezado: 'Fecha de creación',
    tipo: 'fechaHora',
    ancho: 20,
    valor: (f) => fechaHoraExcelMexico(f.createdAt),
  },
  estado: {
    encabezado: 'Estado del pedido',
    tipo: 'texto',
    ancho: 18,
    valor: (f) =>
      f.cancelado ? 'Cancelado' : (ESTADO_PEDIDO[f.estado] ?? f.estado),
  },
  pago: {
    encabezado: 'Estado de pago',
    tipo: 'texto',
    ancho: 16,
    valor: (f) => ESTADO_PAGO[f.estadoPago] ?? f.estadoPago,
  },
  fechaPago: {
    encabezado: 'Fecha de pago',
    tipo: 'fechaHora',
    ancho: 20,
    // Pagados antes de que se guardara la fecha: se sabe que están pagados, no cuándo.
    valor: (f) =>
      f.pagadoAt
        ? fechaHoraExcelMexico(f.pagadoAt)
        : f.estadoPago === 'PAGADO'
          ? 'No registrada'
          : null,
  },
  entregasTotales: {
    encabezado: 'Entregas totales',
    tipo: 'entero',
    ancho: 16,
    valor: (f) => f.estadosEntregas.length,
  },
  entregas: {
    encabezado: 'Entregas',
    tipo: 'entero',
    ancho: 12,
    valor: (f) => f.estadosEntregas.length,
  },
  piezas: {
    encabezado: 'Piezas',
    tipo: 'entero',
    ancho: 10,
    valor: (f) => f.totalPiezas,
  },
  entregadas: {
    encabezado: 'Entregadas',
    tipo: 'entero',
    ancho: 12,
    valor: (f) => cuenta(f, 'ENTREGADA'),
  },
  noRecogidas: {
    encabezado: 'No recogidas',
    tipo: 'entero',
    ancho: 14,
    valor: (f) => cuenta(f, 'NO_RECOGIDA'),
  },
  canceladas: {
    encabezado: 'Canceladas',
    tipo: 'entero',
    ancho: 12,
    valor: (f) => cuenta(f, 'CANCELADA'),
  },
  subtotal: {
    encabezado: 'Subtotal',
    tipo: 'moneda',
    ancho: 14,
    valor: (f) => f.subtotal,
  },
  descuentoPct: {
    encabezado: 'Descuento %',
    tipo: 'decimal',
    ancho: 13,
    valor: (f) => f.descuentoPorcentaje,
  },
  descuentoMonto: {
    encabezado: 'Descuento $',
    tipo: 'moneda',
    ancho: 14,
    valor: (f) => f.descuentoTotal,
  },
  total: { encabezado: 'Total', tipo: 'moneda', ancho: 14, valor: (f) => f.total },
  nota: {
    encabezado: 'Nota del cliente',
    tipo: 'texto',
    ancho: 40,
    valor: (f) => f.notaCliente,
  },
} satisfies Record<string, ColumnaPedidos>;

const COL_ENT = {
  folio: { encabezado: 'Folio', tipo: 'texto', ancho: 14, valor: (f) => f.folio },
  codigo: {
    encabezado: 'Código del cliente',
    tipo: 'texto',
    ancho: 28,
    valor: (f) => f.clienteCodigo,
  },
  negocio: {
    encabezado: 'Negocio',
    tipo: 'texto',
    ancho: 32,
    valor: (f) => f.negocioNombre,
  },
  fecha: {
    encabezado: 'Fecha de entrega',
    tipo: 'fecha',
    ancho: 17,
    valor: (f) => f.fecha,
  },
  dia: {
    encabezado: 'Día',
    tipo: 'texto',
    ancho: 8,
    valor: (f) => DIA_CORTO[f.fecha.getUTCDay()],
  },
  estado: {
    encabezado: 'Estado de la entrega',
    tipo: 'texto',
    ancho: 20,
    valor: (f) => (f.atrasada ? 'Atrasada' : etiquetaEstadoEntrega(f.estado)),
  },
  piezas: {
    encabezado: 'Piezas',
    tipo: 'entero',
    ancho: 10,
    valor: (f) => f.piezas,
  },
  importe: {
    encabezado: 'Importe (antes de descuento)',
    tipo: 'moneda',
    ancho: 28,
    valor: (f) => f.importe,
  },
  subtotal: {
    encabezado: 'Subtotal',
    tipo: 'moneda',
    ancho: 14,
    valor: (f) => f.importe,
  },
  descuento: {
    encabezado: 'Descuento',
    tipo: 'moneda',
    ancho: 14,
    valor: (f) => f.descuento,
  },
  total: {
    encabezado: 'Total',
    tipo: 'moneda',
    ancho: 14,
    valor: (f) => round2(f.importe - f.descuento),
  },
  cerradaAt: {
    encabezado: 'Cerrada el',
    tipo: 'fechaHora',
    ancho: 20,
    valor: (f) => (f.cerradaAt ? fechaHoraExcelMexico(f.cerradaAt) : null),
  },
  nota: {
    encabezado: 'Nota de la entrega',
    tipo: 'texto',
    ancho: 40,
    valor: (f) => f.nota,
  },
} satisfies Record<string, ColumnaEntregaPedidos>;

/** Columnas de Históricos y de Pedidos activos, en orden (cada pantalla tiene las suyas, definidas por producto). */
const COLUMNAS_PEDIDOS: Record<VistaExcelPedidos, ColumnaPedidos[]> = {
  HISTORICOS: [
    COL_PED.negocio,
    COL_PED.semanaInicio,
    COL_PED.semanaFin,
    COL_PED.creacion,
    COL_PED.estado,
    COL_PED.pago,
    COL_PED.fechaPago,
    COL_PED.entregasTotales,
    COL_PED.entregadas,
    COL_PED.noRecogidas,
    COL_PED.canceladas,
    COL_PED.subtotal,
    COL_PED.descuentoPct,
    COL_PED.descuentoMonto,
    COL_PED.total,
    COL_PED.nota,
  ],
  ACTIVOS: [
    COL_PED.negocio,
    COL_PED.semanaInicio,
    COL_PED.semanaFin,
    COL_PED.creacion,
    COL_PED.estado,
    COL_PED.pago,
    COL_PED.entregas,
    COL_PED.piezas,
    COL_PED.subtotal,
    COL_PED.descuentoPct,
    COL_PED.descuentoMonto,
    COL_PED.total,
    COL_PED.nota,
  ],
};

const COLUMNAS_ENTREGAS_PEDIDOS: Record<
  VistaExcelPedidos,
  ColumnaEntregaPedidos[]
> = {
  HISTORICOS: [
    COL_ENT.negocio,
    COL_ENT.fecha,
    COL_ENT.dia,
    COL_ENT.estado,
    COL_ENT.piezas,
    COL_ENT.importe,
    COL_ENT.nota,
  ],
  ACTIVOS: [
    COL_ENT.negocio,
    COL_ENT.fecha,
    COL_ENT.dia,
    COL_ENT.estado,
    COL_ENT.piezas,
    COL_ENT.subtotal,
    COL_ENT.descuento,
    COL_ENT.total,
    COL_ENT.nota,
  ],
};

export async function libroPedidos(
  filas: FilaPedidoExcel[],
  entregas: FilaEntregaPedidoExcel[] = [],
  vista: VistaExcelPedidos = 'HISTORICOS',
): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  agregarHoja<FilaPedidoExcel>(libro, 'Pedidos', COLUMNAS_PEDIDOS[vista], filas);
  agregarHoja<FilaEntregaPedidoExcel>(
    libro,
    'Entregas',
    COLUMNAS_ENTREGAS_PEDIDOS[vista],
    ordenarEntregasPedidos(entregas),
  );
  return libroABuffer(libro);
}

// ---------- Entregas del día ----------

export interface FilaEntregaExcel {
  fecha: Date;
  folio: string;
  clienteCodigo: string | null;
  negocioNombre: string;
  estadoEntrega: string;
  categoria: string;
  producto: string;
  /** ID del producto en el ERP (null si no tiene o el producto ya se borró del catálogo). */
  erpId: string | null;
  cantidad: number;
  precioUnitario: number;
  notaCliente: string | null;
}

export interface FilaConsolidadoExcel {
  fecha: Date;
  categoria: string;
  producto: string;
  erpId: string | null;
  cantidadTotal: number;
  clientes: number;
}

/** Consolidado: una fila por (categoría, producto) sumando exactamente las filas de la hoja Entregas. Clientes = negocios distintos. */
export function consolidar(filas: FilaEntregaExcel[]): FilaConsolidadoExcel[] {
  const grupos = new Map<
    string,
    FilaConsolidadoExcel & { negocios: Set<string> }
  >();
  for (const f of filas) {
    const clave = `${f.categoria}\u0000${f.producto}`;
    const g = grupos.get(clave) ?? {
      fecha: f.fecha,
      categoria: f.categoria,
      producto: f.producto,
      erpId: f.erpId,
      cantidadTotal: 0,
      clientes: 0,
      negocios: new Set<string>(),
    };
    g.cantidadTotal += f.cantidad;
    g.negocios.add(f.negocioNombre);
    grupos.set(clave, g);
  }
  return [...grupos.values()]
    .map(({ negocios, ...g }) => ({ ...g, clientes: negocios.size }))
    .sort(
      (a, b) =>
        a.categoria.localeCompare(b.categoria, 'es') ||
        a.producto.localeCompare(b.producto, 'es'),
    );
}

export async function libroEntregasDia(
  filas: FilaEntregaExcel[],
): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  agregarHoja<FilaEntregaExcel>(
    libro,
    'Entregas',
    [
      {
        encabezado: 'Fecha de entrega',
        tipo: 'fecha',
        ancho: 17,
        valor: (f) => f.fecha,
      },
      {
        encabezado: 'Negocio',
        tipo: 'texto',
        ancho: 32,
        valor: (f) => f.negocioNombre,
      },
      {
        encabezado: 'Estado de la entrega',
        tipo: 'texto',
        ancho: 20,
        valor: (f) => etiquetaEstadoEntrega(f.estadoEntrega),
      },
      {
        encabezado: 'Categoría',
        tipo: 'texto',
        ancho: 24,
        valor: (f) => f.categoria,
      },
      {
        encabezado: 'Producto',
        tipo: 'texto',
        ancho: 34,
        valor: (f) => f.producto,
      },
      {
        encabezado: 'ID del ERP',
        tipo: 'texto',
        ancho: 18,
        valor: (f) => f.erpId,
      },
      {
        encabezado: 'Cantidad',
        tipo: 'entero',
        ancho: 11,
        valor: (f) => f.cantidad,
      },
      {
        encabezado: 'Precio unitario',
        tipo: 'moneda',
        ancho: 15,
        valor: (f) => f.precioUnitario,
      },
      {
        encabezado: 'Subtotal',
        tipo: 'moneda',
        ancho: 14,
        valor: (f) => round2(f.cantidad * f.precioUnitario),
      },
      {
        encabezado: 'Nota del cliente',
        tipo: 'texto',
        ancho: 40,
        valor: (f) => f.notaCliente,
      },
    ],
    filas,
  );
  agregarHoja<FilaConsolidadoExcel>(
    libro,
    'Consolidado',
    [
      { encabezado: 'Fecha', tipo: 'fecha', ancho: 14, valor: (f) => f.fecha },
      {
        encabezado: 'Categoría',
        tipo: 'texto',
        ancho: 24,
        valor: (f) => f.categoria,
      },
      {
        encabezado: 'Producto',
        tipo: 'texto',
        ancho: 34,
        valor: (f) => f.producto,
      },
      {
        encabezado: 'ID del ERP',
        tipo: 'texto',
        ancho: 18,
        valor: (f) => f.erpId,
      },
      {
        encabezado: 'Cantidad total',
        tipo: 'entero',
        ancho: 16,
        valor: (f) => f.cantidadTotal,
      },
      {
        encabezado: 'Clientes',
        tipo: 'entero',
        ancho: 11,
        valor: (f) => f.clientes,
      },
    ],
    consolidar(filas),
  );
  return libroABuffer(libro);
}
