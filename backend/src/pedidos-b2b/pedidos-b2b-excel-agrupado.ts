import ExcelJS from 'exceljs';
import { EstadoEntrega } from '../../generated/prisma/client';
import { round2 } from '../common/money';
import {
  agregarHoja,
  fechaExcel,
  FORMATO_XLSX,
  libroABuffer,
} from '../common/xlsx';
import {
  BORDE,
  configurarImpresion,
  encabezadoDeHoja,
  FONDO_ENCABEZADO,
  FONDO_ENTREGA,
} from '../common/xlsx-estilo';
import {
  COLUMNAS_ENTREGAS_PEDIDOS,
  COLUMNAS_PEDIDOS,
  COL_ENT,
  COL_PED,
  ordenarEntregasPedidos,
  type FilaEntregaPedidoExcel,
  type FilaPedidoExcel,
  type VistaExcelPedidos,
} from './pedidos-b2b-excel';
import { filasExcelDePedidos, type PedidoExport } from './pedidos-b2b-export';
import {
  bloquesDePedido,
  etiquetaDescuento,
  type BloqueMonto,
} from './pedidos-b2b-bloque-descuento';

/**
 * Excel de Históricos del panel con bloques por negocio, pedido y entrega (hojas «Pedidos» y «Entregas»), más las dos tablas
 * planas de siempre al final («Datos pedidos» y «Datos entregas») para filtrar y hacer tablas dinámicas. Mismos datos y mismos
 * filtros que el export plano: solo cambia cómo se presentan. Los montos por producto son ANTES del descuento; el descuento y
 * el total viven en el renglón del pedido. Estilo compartido con el Excel del resumen por cliente (common/xlsx-estilo.ts).
 */

const FONDO_NEGOCIO = 'FFD9E2EC';
const DIAS = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];
const FECHA_SEMANA = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export interface LineaProductoExcel {
  producto: string;
  unidades: number;
  /** Precio por unidad de la línea del pedido (antes de descuento): unidades × precio = monto. */
  precio: number;
  monto: number;
}

export interface EntregaAgrupadaExcel {
  fila: FilaEntregaPedidoExcel;
  lineas: LineaProductoExcel[];
}

export interface PedidoAgrupadoExcel {
  fila: FilaPedidoExcel;
  /** Suma de las entregas NO canceladas, un renglón por producto. */
  lineas: LineaProductoExcel[];
  entregas: EntregaAgrupadaExcel[];
}

export interface NegocioAgrupadoExcel {
  nombre: string;
  pedidos: PedidoAgrupadoExcel[];
}

const sumaLineas = (lineas: LineaProductoExcel[]) =>
  round2(lineas.reduce((s, l) => s + l.monto, 0));

/** Une líneas del mismo producto (nombre y precio) y las ordena por nombre. */
function consolidar(
  items: { producto: string; precio: number; unidades: number }[],
): LineaProductoExcel[] {
  const grupos = new Map<
    string,
    { producto: string; precio: number; unidades: number }
  >();
  for (const i of items) {
    const clave = `${i.producto}\u0000${i.precio}`;
    const g = grupos.get(clave) ?? {
      producto: i.producto,
      precio: i.precio,
      unidades: 0,
    };
    g.unidades += i.unidades;
    grupos.set(clave, g);
  }
  return [...grupos.values()]
    .sort((a, b) => a.producto.localeCompare(b.producto, 'es'))
    .map((g) => ({
      producto: g.producto,
      unidades: g.unidades,
      precio: g.precio,
      monto: round2(g.unidades * g.precio),
    }));
}

/** Negocios en orden alfabético; dentro de cada uno, los pedidos en el orden recibido (semana de la más reciente a la más antigua). */
export function agruparPorNegocio(
  pedidos: PedidoExport[],
): NegocioAgrupadoExcel[] {
  const porNegocio = new Map<string, PedidoAgrupadoExcel[]>();
  for (const o of pedidos) {
    const { filas, entregas } = filasExcelDePedidos([o]);
    const vivas = o.entregas.filter(
      (e) => e.estado !== EstadoEntrega.CANCELADA,
    );
    const entregasAgrupadas: EntregaAgrupadaExcel[] = vivas.map((e, n) => ({
      fila: entregas[n],
      lineas: consolidar(
        e.items.map((i) => ({
          producto: i.orderItem.nombreProducto,
          precio: Number(i.orderItem.precioUnitario),
          unidades: i.cantidad,
        })),
      ),
    }));
    const pedido: PedidoAgrupadoExcel = {
      fila: filas[0],
      lineas: consolidar(
        vivas.flatMap((e) =>
          e.items.map((i) => ({
            producto: i.orderItem.nombreProducto,
            precio: Number(i.orderItem.precioUnitario),
            unidades: i.cantidad,
          })),
        ),
      ),
      entregas: entregasAgrupadas.sort(
        (a, b) => a.fila.fecha.getTime() - b.fila.fecha.getTime(),
      ),
    };
    const nombre = filas[0].negocioNombre;
    porNegocio.set(nombre, [...(porNegocio.get(nombre) ?? []), pedido]);
  }
  return [...porNegocio.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'es'))
    .map(([nombre, ps]) => ({ nombre, pedidos: ps }));
}

// ---------- Estilo uniforme ----------
// Un solo criterio para ambas hojas: cada tipo de renglón lleva el MISMO relleno y el MISMO borde (solo horizontal, nunca
// vertical) en TODAS sus celdas, de la primera a la última columna de la tabla. Las bandas y los cierres no se combinan
// (celdas combinadas pierden el borde en algunas celdas): el texto de la columna A se desborda sobre las vacías de al lado.

const BORDE_GRUESO = { style: 'medium' as const, color: { argb: 'FF7F7F7F' } };
type Borde = Partial<ExcelJS.Borders>;
const BORDE_FINO: Borde = { top: BORDE, bottom: BORDE };
const BORDE_BANDA: Borde = { top: BORDE_GRUESO, bottom: BORDE };
const BORDE_SUPERIOR: Borde = { top: BORDE };

function estilar(
  fila: ExcelJS.Row,
  columnas: number,
  opciones: { fondo?: string; borde?: Borde },
) {
  for (let c = 1; c <= columnas; c++) {
    const celda = fila.getCell(c);
    if (opciones.fondo)
      celda.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: opciones.fondo },
      };
    if (opciones.borde) celda.border = opciones.borde;
  }
}

/** Encabezados de la hoja: todos con ajuste de texto y altura para dos líneas, así ninguno se corta. */
function encabezadoUniforme(
  hoja: ExcelJS.Worksheet,
  columnas: number,
  derecha: number[],
) {
  encabezadoDeHoja(hoja);
  const fila = hoja.getRow(1);
  fila.height = 34;
  for (let c = 1; c <= columnas; c++) {
    const celda = fila.getCell(c);
    celda.alignment = {
      vertical: 'middle',
      wrapText: true,
      horizontal: derecha.includes(c) ? 'right' : 'left',
    };
    celda.border = BORDE_FINO;
    celda.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: FONDO_ENCABEZADO },
    };
  }
}

function bandaNegocio(
  hoja: ExcelJS.Worksheet,
  texto: string,
  columnas: number,
) {
  const fila = hoja.addRow([texto]);
  fila.font = { bold: true, size: 12 };
  fila.alignment = { vertical: 'middle' };
  fila.height = 22;
  estilar(fila, columnas, { fondo: FONDO_NEGOCIO, borde: BORDE_BANDA });
}

/** «10%», «10% y 15%», «5%, 10% y 15%». */
function listaPorcentajes(porcentajes: number[]): string {
  const t = porcentajes.map((p) => `${Number(p.toFixed(2))}%`);
  return t.length <= 1
    ? (t[0] ?? '')
    : `${t.slice(0, -1).join(', ')} y ${t[t.length - 1]}`;
}

/**
 * Texto de la banda del negocio en «Pedidos»: el nombre y, si algún pedido del export tiene descuento, los porcentajes distintos
 * (de menor a mayor) una sola vez: «Café Aurora · 10% de descuento» o «Café Aurora · 10% y 15% de descuento». Un pedido sin
 * descuento del mismo negocio no cambia la banda (su columna «Descuento» dice $0.00). Sin descuento en ninguno, solo el nombre.
 */
export function textoBandaNegocio(
  nombre: string,
  pedidos: PedidoAgrupadoExcel[],
): string {
  const porcentajes = new Set<number>();
  for (const { fila } of pedidos) {
    if (fila.descuentoTotal <= 0) continue;
    const efectivo =
      fila.descuentoPorcentaje > 0
        ? fila.descuentoPorcentaje
        : fila.subtotal > 0
          ? Math.round((fila.descuentoTotal / fila.subtotal) * 10000) / 100
          : 0;
    if (efectivo > 0) porcentajes.add(Number(efectivo.toFixed(2)));
  }
  if (porcentajes.size === 0) return nombre;
  return `${nombre} · ${listaPorcentajes([...porcentajes].sort((a, b) => a - b))} de descuento`;
}

// ---------- Hoja «Pedidos» ----------

// Distribución (8 columnas). A queda libre en el renglón del pedido: es la columna de nombres (negocio en la banda, productos
// debajo). Los datos del pedido empiezan en B. El detalle de productos usa D–F (Unidades, Precio unitario, Monto) para que el
// «Monto» y «Subtotal de productos» queden en la columna F, la del Subtotal del pedido, de la que son el desglose.
const COL_DESCUENTO_PEDIDOS = {
  ...COL_PED.descuentoMonto,
  encabezado: 'Descuento',
};
const COLUMNAS_PEDIDOS_BLOQUE = [
  COL_PED.semanaInicio,
  COL_PED.semanaFin,
  COL_PED.creacion,
  COL_PED.entregasTotales,
  COL_PED.subtotal,
  COL_DESCUENTO_PEDIDOS,
  COL_PED.total,
];
// Con `conEstados` (Pedidos activos y resumen semanal al negocio) se AGREGAN al final, sin mover nada de lo anterior, el estado del
// pedido y el de pago: Históricos no los lleva en la vista agrupada, pero en esos reportes sí hacen falta.
const COLUMNAS_ESTADOS_PEDIDOS = [COL_PED.estado, COL_PED.pago];
const COL_UNIDADES = 4;
const COL_PRECIO = 5;
const COL_MONTO = 6;
// Marca discreta de un pedido cancelado, sin columna de estado: su Total (lo que queda por cobrar) lleva el sufijo «Cancelado».
const FORMATO_TOTAL_CANCELADO = '"$"#,##0.00" · Cancelado"';

function hojaPedidos(
  libro: ExcelJS.Workbook,
  negocios: NegocioAgrupadoExcel[],
  conEstados: boolean,
) {
  const columnasPedido = conEstados
    ? [...COLUMNAS_PEDIDOS_BLOQUE, ...COLUMNAS_ESTADOS_PEDIDOS]
    : COLUMNAS_PEDIDOS_BLOQUE;
  const N_PEDIDOS = columnasPedido.length + 1;
  const hoja = libro.addWorksheet('Pedidos', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const anchos = [36, 16, 14, 20, 16, 16, 16, 26, 18, 16]; // H cabe «$12,345.00 · Cancelado»
  hoja.columns = [
    { header: 'Negocio / Producto', width: anchos[0] },
    ...columnasPedido.map((c, i) => ({
      header: c.encabezado,
      width: anchos[i + 1],
    })),
  ];
  encabezadoUniforme(hoja, N_PEDIDOS, [5, 6, 7, 8]);

  negocios.forEach((negocio, n) => {
    if (n > 0) hoja.addRow([]); // separación entre negocios
    bandaNegocio(
      hoja,
      textoBandaNegocio(negocio.nombre, negocio.pedidos),
      N_PEDIDOS,
    );

    negocio.pedidos.forEach((pedido, p) => {
      if (p > 0) hoja.addRow([]); // separación entre pedidos
      const fila = hoja.addRow([
        null,
        ...columnasPedido.map((c) => c.valor(pedido.fila) ?? null),
      ]);
      columnasPedido.forEach((c, i) => {
        if (c.tipo !== 'texto')
          fila.getCell(i + 2).numFmt =
            pedido.fila.cancelado && c === COL_PED.total
              ? FORMATO_TOTAL_CANCELADO
              : FORMATO_XLSX[c.tipo];
      });
      fila.font = { bold: true };
      fila.alignment = { vertical: 'top', wrapText: true };
      estilar(fila, N_PEDIDOS, { fondo: FONDO_ENTREGA, borde: BORDE_FINO });

      if (pedido.lineas.length === 0) return;
      const sub = hoja.addRow([]);
      sub.getCell(1).value = 'Producto';
      sub.getCell(COL_UNIDADES).value = 'Unidades';
      sub.getCell(COL_PRECIO).value = 'Precio unitario';
      sub.getCell(COL_MONTO).value = 'Monto';
      sub.font = { italic: true, color: { argb: 'FF595959' } };
      for (const c of [COL_UNIDADES, COL_PRECIO, COL_MONTO])
        sub.getCell(c).alignment = { horizontal: 'right' };
      sub.getCell(1).alignment = { indent: 1 };
      estilar(sub, N_PEDIDOS, { borde: { bottom: BORDE } });
      for (const l of pedido.lineas) {
        const r = hoja.addRow([]);
        r.getCell(1).value = l.producto;
        r.getCell(COL_UNIDADES).value = l.unidades;
        r.getCell(COL_PRECIO).value = l.precio;
        r.getCell(COL_MONTO).value = l.monto;
        r.getCell(1).alignment = { indent: 1, wrapText: true, vertical: 'top' };
        r.getCell(COL_UNIDADES).numFmt = FORMATO_XLSX.entero;
        r.getCell(COL_PRECIO).numFmt = FORMATO_XLSX.moneda;
        r.getCell(COL_MONTO).numFmt = FORMATO_XLSX.moneda;
      }
      const total = hoja.addRow([]);
      total.getCell(1).value = 'Subtotal de productos';
      total.getCell(COL_MONTO).value = sumaLineas(pedido.lineas);
      total.getCell(COL_MONTO).numFmt = FORMATO_XLSX.moneda;
      total.font = { bold: true };
      total.getCell(1).alignment = { indent: 1 };
      estilar(total, N_PEDIDOS, { borde: BORDE_SUPERIOR });
    });
  });
  configurarImpresion(hoja);
}

// ---------- Hoja «Entregas» ----------

const COLUMNAS_ENTREGAS = 5;
const COL_IMPORTE = 5;

/**
 * Bloque Subtotal / Descuento (con %) / Total bajo una entrega o un pedido; el importe va en la columna E («Importe / Monto»).
 * Entrega: solo si tiene descuento. Pedido (`cierre`): SIEMPRE tres renglones, también sin descuento («Descuento (0%)» $0.00).
 */
function filasBloque(
  hoja: ExcelJS.Worksheet,
  b: BloqueMonto,
  porcentaje: number,
  etiquetas: { subtotal: string; total: string },
  cierre: boolean,
  columnas: number,
  cancelado = false,
) {
  if (!cierre && b.descuento <= 0) return;
  const filas: [string, number][] = [
    [etiquetas.subtotal, b.subtotal],
    [etiquetaDescuento(porcentaje), b.descuento],
    [
      cancelado ? `${etiquetas.total} (cancelado)` : etiquetas.total,
      b.total,
    ],
  ];
  filas.forEach(([etiqueta, valor], i) => {
    const r = hoja.addRow([]);
    r.getCell(1).value = etiqueta;
    r.getCell(COL_IMPORTE).value = valor;
    r.getCell(COL_IMPORTE).numFmt = FORMATO_XLSX.moneda;
    const esTotal = i === filas.length - 1;
    if (cierre) {
      r.font = { bold: true };
      estilar(r, columnas, {
        fondo: FONDO_ENCABEZADO,
        borde: i === 0 ? BORDE_BANDA : BORDE_FINO,
      });
    } else {
      r.getCell(1).alignment = { indent: 1 };
      r.font = esTotal
        ? { bold: true }
        : { italic: true, color: { argb: 'FF595959' } };
      estilar(r, columnas, {
        borde: esTotal || i === 0 ? BORDE_SUPERIOR : undefined,
      });
    }
  });
}

function hojaEntregas(
  libro: ExcelJS.Workbook,
  negocios: NegocioAgrupadoExcel[],
  conEstados: boolean,
) {
  // Con `conEstados` se agrega al final el estado de la entrega («Atrasada» incluida); las demás columnas no se mueven.
  const nCols = COLUMNAS_ENTREGAS + (conEstados ? 1 : 0);
  const hoja = libro.addWorksheet('Entregas', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  hoja.columns = [
    { header: 'Día / Producto', width: 34 },
    { header: COL_ENT.fecha.encabezado, width: 18 },
    { header: 'Piezas / Unidades', width: 20 },
    { header: 'Precio unitario', width: 16 },
    { header: 'Importe / Monto (antes de descuento)', width: 28 },
    ...(conEstados
      ? [{ header: COL_ENT.estado.encabezado, width: 20 }]
      : []),
  ];
  encabezadoUniforme(hoja, nCols, [3, 4, 5]);

  // Si el export abarca más de una semana, cada pedido lleva su encabezado de semana; con una sola, sobra.
  const semanas = new Set(
    negocios.flatMap((n) =>
      n.pedidos.map((p) => p.fila.semanaInicio.getTime()),
    ),
  );
  const variasSemanas = semanas.size > 1;

  negocios.forEach((negocio, n) => {
    if (n > 0) hoja.addRow([]);
    bandaNegocio(hoja, negocio.nombre, nCols);

    negocio.pedidos.forEach((pedido, p) => {
      if (variasSemanas) {
        if (p > 0) hoja.addRow([]);
        const inicio = fechaExcel(pedido.fila.semanaInicio);
        const fin = new Date(inicio);
        fin.setUTCDate(fin.getUTCDate() + 6);
        const semana = hoja.addRow([
          `Semana del ${FECHA_SEMANA.format(inicio)} al ${FECHA_SEMANA.format(fin)}`,
        ]);
        semana.font = { bold: true };
        estilar(semana, nCols, {
          fondo: FONDO_ENCABEZADO,
          borde: BORDE_FINO,
        });
      }
      const bloque =
        pedido.entregas.length > 0
          ? bloquesDePedido({
              entregas: pedido.entregas.map((x) => ({
                importe: x.fila.importe,
                fecha: x.fila.fecha,
              })),
              descuentoTotal: pedido.fila.descuentoTotal,
              total: pedido.fila.total,
              porcentaje: pedido.fila.descuentoPorcentaje,
            })
          : null;
      pedido.entregas.forEach((entrega, e) => {
        if (e > 0 || (!variasSemanas && p > 0)) hoja.addRow([]); // separación entre entregas
        const f = entrega.fila;
        const enc = hoja.addRow([
          DIAS[f.fecha.getUTCDay()],
          COL_ENT.fecha.valor(f),
          f.piezas,
          null,
          f.importe,
          conEstados ? COL_ENT.estado.valor(f) : null,
        ]);
        enc.getCell(2).numFmt = FORMATO_XLSX.fecha;
        enc.getCell(2).alignment = { horizontal: 'left' };
        enc.getCell(3).numFmt = FORMATO_XLSX.entero;
        enc.getCell(COL_IMPORTE).numFmt = FORMATO_XLSX.moneda;
        enc.font = { bold: true };
        enc.alignment = { vertical: 'top', wrapText: true };
        estilar(enc, nCols, {
          fondo: FONDO_ENTREGA,
          borde: BORDE_FINO,
        });
        for (const l of entrega.lineas) {
          const r = hoja.addRow([
            l.producto,
            null,
            l.unidades,
            l.precio,
            l.monto,
          ]);
          r.getCell(1).alignment = {
            indent: 1,
            wrapText: true,
            vertical: 'top',
          };
          r.getCell(3).numFmt = FORMATO_XLSX.entero;
          r.getCell(4).numFmt = FORMATO_XLSX.moneda;
          r.getCell(COL_IMPORTE).numFmt = FORMATO_XLSX.moneda;
        }
        if (bloque)
          filasBloque(
            hoja,
            bloque.entregas[e],
            bloque.porcentaje,
            { subtotal: 'Subtotal', total: 'Total de la entrega' },
            false,
            nCols,
          );
      });
      if (bloque)
        filasBloque(
          hoja,
          bloque,
          bloque.porcentaje,
          { subtotal: 'Subtotal del pedido', total: 'Total del pedido' },
          true,
          nCols,
          pedido.fila.cancelado,
        );
    });
  });
  configurarImpresion(hoja);
}

export interface OpcionesLibroAgrupado {
  /**
   * Agrega a las hojas agrupadas el estado del pedido, el de pago y el de la entrega (Pedidos activos y resumen semanal al
   * negocio). Históricos no los lleva ahí (están en las tablas planas).
   */
  conEstados?: boolean;
  /** Columnas de las dos tablas planas del final («Datos pedidos» y «Datos entregas»): las de cada reporte. */
  vistaPlana?: VistaExcelPedidos;
}

/**
 * Libro con bloques (hojas «Pedidos» y «Entregas») y, al final, las dos tablas planas con todas las columnas del reporte. Lo usan
 * Históricos, Pedidos activos y el resumen semanal al negocio: mismo formato, mismas reglas de diseño.
 */
export async function libroPedidosAgrupado(
  pedidos: PedidoExport[],
  opciones: OpcionesLibroAgrupado = {},
): Promise<Buffer> {
  const conEstados = opciones.conEstados ?? false;
  const vista = opciones.vistaPlana ?? 'HISTORICOS';
  const negocios = agruparPorNegocio(pedidos);
  const { filas, entregas } = filasExcelDePedidos(pedidos);
  const libro = new ExcelJS.Workbook();
  hojaPedidos(libro, negocios, conEstados);
  hojaEntregas(libro, negocios, conEstados);
  agregarHoja<FilaPedidoExcel>(
    libro,
    'Datos pedidos',
    COLUMNAS_PEDIDOS[vista],
    filas,
  );
  agregarHoja<FilaEntregaPedidoExcel>(
    libro,
    'Datos entregas',
    COLUMNAS_ENTREGAS_PEDIDOS[vista],
    ordenarEntregasPedidos(entregas),
  );
  return libroABuffer(libro);
}
