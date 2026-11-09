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
} from './pedidos-b2b-excel';
import { filasExcelDePedidos, type PedidoExport } from './pedidos-b2b-export';

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

function rellenar(
  fila: ExcelJS.Row,
  columnas: number,
  fondo: string,
  borde: Partial<ExcelJS.Borders> = { top: BORDE, bottom: BORDE },
) {
  for (let c = 1; c <= columnas; c++) {
    const celda = fila.getCell(c);
    celda.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: fondo },
    };
    celda.border = borde;
  }
}

function bandaNegocio(
  hoja: ExcelJS.Worksheet,
  nombre: string,
  columnas: number,
) {
  const fila = hoja.addRow([nombre]);
  hoja.mergeCells(fila.number, 1, fila.number, columnas);
  fila.font = { bold: true, size: 12 };
  fila.alignment = { vertical: 'middle' };
  fila.height = 22;
  rellenar(fila, columnas, FONDO_NEGOCIO, {
    top: { style: 'medium', color: { argb: 'FF7F7F7F' } },
    bottom: BORDE,
  });
}

// ---------- Hoja «Pedidos» ----------

const COLUMNAS_BLOQUE_PEDIDOS = COLUMNAS_PEDIDOS.HISTORICOS.filter(
  (c) => c !== COL_PED.negocio,
);

function hojaPedidos(
  libro: ExcelJS.Workbook,
  negocios: NegocioAgrupadoExcel[],
) {
  const hoja = libro.addWorksheet('Pedidos', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const columnas = COLUMNAS_BLOQUE_PEDIDOS;
  // La primera columna también aloja los productos (sangrados) debajo de cada pedido: se ensancha para que quepan.
  hoja.columns = columnas.map((c, i) => ({
    header: c.encabezado,
    width: i === 0 ? Math.max(c.ancho ?? 16, 34) : (c.ancho ?? 14),
  }));
  encabezadoDeHoja(hoja);

  negocios.forEach((negocio, n) => {
    if (n > 0) hoja.addRow([]); // separación entre negocios
    bandaNegocio(hoja, negocio.nombre, columnas.length);

    negocio.pedidos.forEach((pedido, p) => {
      if (p > 0) hoja.addRow([]); // separación entre pedidos
      const fila = hoja.addRow(
        columnas.map((c) => c.valor(pedido.fila) ?? null),
      );
      columnas.forEach((c, i) => {
        if (c.tipo !== 'texto')
          fila.getCell(i + 1).numFmt = FORMATO_XLSX[c.tipo];
      });
      fila.font = { bold: true };
      fila.alignment = { vertical: 'top', wrapText: true };
      rellenar(fila, columnas.length, FONDO_ENTREGA);

      if (pedido.lineas.length === 0) return;
      const sub = hoja.addRow(['Producto', 'Unidades', 'Monto']);
      sub.font = { italic: true, color: { argb: 'FF595959' } };
      sub.getCell(2).alignment = { horizontal: 'right' };
      sub.getCell(3).alignment = { horizontal: 'right' };
      for (const l of pedido.lineas) {
        const r = hoja.addRow([l.producto, l.unidades, l.monto]);
        r.getCell(1).alignment = { indent: 1, wrapText: true, vertical: 'top' };
        r.getCell(2).numFmt = FORMATO_XLSX.entero;
        r.getCell(3).numFmt = FORMATO_XLSX.moneda;
      }
      const total = hoja.addRow([
        'Subtotal de productos',
        null,
        sumaLineas(pedido.lineas),
      ]);
      total.font = { bold: true };
      total.getCell(3).numFmt = FORMATO_XLSX.moneda;
      total.getCell(1).alignment = { indent: 1 };
      for (let c = 1; c <= 3; c++) total.getCell(c).border = { top: BORDE };
    });
  });
  configurarImpresion(hoja);
}

// ---------- Hoja «Entregas» ----------

const COLUMNAS_ENTREGAS = 6;

function hojaEntregas(
  libro: ExcelJS.Workbook,
  negocios: NegocioAgrupadoExcel[],
) {
  const hoja = libro.addWorksheet('Entregas', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  hoja.columns = [
    { header: 'Día / Producto', width: 34 },
    { header: COL_ENT.fecha.encabezado, width: 16 },
    { header: COL_ENT.estado.encabezado, width: 20 },
    { header: 'Piezas / Unidades', width: 17 },
    { header: 'Importe / Monto (antes de descuento)', width: 26 },
    { header: COL_ENT.nota.encabezado, width: 40 },
  ];
  encabezadoDeHoja(hoja);
  for (const c of [4, 5])
    hoja.getRow(1).getCell(c).alignment = {
      horizontal: 'right',
      vertical: 'middle',
      wrapText: true,
    };

  // Si el export abarca más de una semana, cada pedido lleva su encabezado de semana; con una sola, sobra.
  const semanas = new Set(
    negocios.flatMap((n) =>
      n.pedidos.map((p) => p.fila.semanaInicio.getTime()),
    ),
  );
  const variasSemanas = semanas.size > 1;

  negocios.forEach((negocio, n) => {
    if (n > 0) hoja.addRow([]);
    bandaNegocio(hoja, negocio.nombre, COLUMNAS_ENTREGAS);

    negocio.pedidos.forEach((pedido, p) => {
      if (variasSemanas) {
        if (p > 0) hoja.addRow([]);
        const inicio = fechaExcel(pedido.fila.semanaInicio);
        const fin = new Date(inicio);
        fin.setUTCDate(fin.getUTCDate() + 6);
        const semana = hoja.addRow([
          `Semana del ${FECHA_SEMANA.format(inicio)} al ${FECHA_SEMANA.format(fin)}`,
        ]);
        hoja.mergeCells(semana.number, 1, semana.number, COLUMNAS_ENTREGAS);
        semana.font = { bold: true };
        rellenar(semana, COLUMNAS_ENTREGAS, FONDO_ENCABEZADO);
      }
      pedido.entregas.forEach((entrega, e) => {
        if (e > 0 || (!variasSemanas && p > 0)) hoja.addRow([]); // separación entre entregas
        const f = entrega.fila;
        const enc = hoja.addRow([
          DIAS[f.fecha.getUTCDay()],
          COL_ENT.fecha.valor(f),
          COL_ENT.estado.valor(f),
          f.piezas,
          f.importe,
          f.nota,
        ]);
        enc.getCell(2).numFmt = FORMATO_XLSX.fecha;
        enc.getCell(4).numFmt = FORMATO_XLSX.entero;
        enc.getCell(5).numFmt = FORMATO_XLSX.moneda;
        enc.font = { bold: true };
        enc.alignment = { vertical: 'top', wrapText: true };
        rellenar(enc, COLUMNAS_ENTREGAS, FONDO_ENTREGA);
        for (const l of entrega.lineas) {
          const r = hoja.addRow([l.producto, null, null, l.unidades, l.monto]);
          r.getCell(1).alignment = {
            indent: 1,
            wrapText: true,
            vertical: 'top',
          };
          r.getCell(4).numFmt = FORMATO_XLSX.entero;
          r.getCell(5).numFmt = FORMATO_XLSX.moneda;
        }
      });
    });
  });
  configurarImpresion(hoja);
}

/** Libro de Históricos del panel: hojas con bloques y, al final, las dos tablas planas de siempre. */
export async function libroPedidosAgrupado(
  pedidos: PedidoExport[],
): Promise<Buffer> {
  const negocios = agruparPorNegocio(pedidos);
  const { filas, entregas } = filasExcelDePedidos(pedidos);
  const libro = new ExcelJS.Workbook();
  hojaPedidos(libro, negocios);
  hojaEntregas(libro, negocios);
  agregarHoja<FilaPedidoExcel>(
    libro,
    'Datos pedidos',
    COLUMNAS_PEDIDOS.HISTORICOS,
    filas,
  );
  agregarHoja<FilaEntregaPedidoExcel>(
    libro,
    'Datos entregas',
    COLUMNAS_ENTREGAS_PEDIDOS.HISTORICOS,
    ordenarEntregasPedidos(entregas),
  );
  return libroABuffer(libro);
}
