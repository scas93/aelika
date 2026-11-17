import ExcelJS from 'exceljs';
import { EstadoEntrega, Prisma } from '../../generated/prisma/client';
import {
  filasExcelDePedidos,
  PEDIDOS_EXPORT_SELECT,
} from '../pedidos-b2b/pedidos-b2b-export';
import type { FilaPedidoExcel } from '../pedidos-b2b/pedidos-b2b-excel';
import {
  fechaExcel,
  fechaHoraExcelMexico,
  FORMATO_XLSX,
  libroABuffer,
} from '../common/xlsx';
import { dinero, fechaLarga } from './resumen-semanal';
import {
  bloquesDePedido,
  etiquetaDescuento,
} from '../pedidos-b2b/pedidos-b2b-bloque-descuento';
import { round2 } from '../common/money';
import {
  BORDE,
  configurarImpresion,
  encabezadoDeHoja,
  FONDO_ENCABEZADO,
  FONDO_ENTREGA,
} from '../common/xlsx-estilo';

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

/**
 * Una línea (un producto) de una entrega. `monto` es NETO (ya sin la parte del descuento que le toca) y lo usa el cuerpo del
 * correo; el Excel de la hoja «Entregas» muestra `precio` y `montoLista` (unidades × precio, exacto, antes de descuento).
 */
export interface LineaEntregaCliente {
  folio: string;
  entregaId: string;
  fecha: Date;
  producto: string;
  unidades: number;
  /** Precio unitario de lista de la línea del pedido. */
  precio: number;
  /** unidades × precio (lista, antes de descuento). */
  montoLista: number;
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
          precio: Number(i.orderItem.precioUnitario),
          montoLista: round2(i.cantidad * Number(i.orderItem.precioUnitario)),
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

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** "2026-10-27" (fecha UTC a medianoche) → "martes 27 de octubre". */
export function diaLargo(fecha: Date): string {
  return `${DIAS[fecha.getUTCDay()]} ${fechaLarga(fecha.toISOString().slice(0, 10))}`;
}

const piezas = (n: number) => `${n} ${n === 1 ? 'pieza' : 'piezas'}`;
const centavos = (n: number) => Math.round(n * 100);

/** Una entrega con sus productos y sus totales (en centavos). */
interface EntregaAgrupada {
  entregaId: string;
  folio: string;
  fecha: Date;
  nota: string | null;
  lineas: LineaEntregaCliente[];
  piezas: number;
  centavos: number;
}

/**
 * Sin columna de folio, el orden es lo que agrupa: fecha de entrega, luego pedido (por folio, solo para ordenar; no se muestra),
 * luego la entrega y el producto (por nombre).
 */
function ordenarLineas(lineas: LineaEntregaCliente[]): LineaEntregaCliente[] {
  return [...lineas].sort(
    (a, b) =>
      a.fecha.getTime() - b.fecha.getTime() ||
      a.folio.localeCompare(b.folio, 'es', { numeric: true }) ||
      a.entregaId.localeCompare(b.entregaId) ||
      a.producto.localeCompare(b.producto, 'es'),
  );
}

function agruparEntregas(lineas: LineaEntregaCliente[]): EntregaAgrupada[] {
  const porId = new Map<string, EntregaAgrupada>();
  for (const l of ordenarLineas(lineas)) {
    let e = porId.get(l.entregaId);
    if (!e) {
      e = { entregaId: l.entregaId, folio: l.folio, fecha: l.fecha, nota: l.nota, lineas: [], piezas: 0, centavos: 0 };
      porId.set(l.entregaId, e);
    }
    e.lineas.push(l);
    e.piezas += l.unidades;
    e.centavos += centavos(l.monto);
  }
  return [...porId.values()];
}

function hojaPedidos(libro: ExcelJS.Workbook, filas: FilaPedidoExcel[], lineas: LineaEntregaCliente[]) {
  const hoja = libro.addWorksheet('Pedidos', { views: [{ state: 'frozen', ySplit: 1 }] });
  hoja.columns = [
    { header: 'Negocio', width: 28 },
    { header: 'Semana (inicio)', width: 15 },
    { header: 'Semana (fin)', width: 13 },
    { header: 'Fecha de creación', width: 19 },
    { header: 'Entregas totales', width: 11 },
    { header: 'Detalle de entregas', width: 50 },
    { header: 'Total', width: 14 },
    { header: 'Nota del cliente', width: 36 },
  ];
  encabezadoDeHoja(hoja);
  for (const f of filas) {
    // Detalle: una entrega por línea (día y fecha, piezas e importe), ordenado por fecha. Pedido cancelado: sin detalle.
    const detalle = f.cancelado
      ? []
      : agruparEntregas(lineas.filter((l) => l.folio === f.folio)).map(
          (e) => `${diaLargo(e.fecha)} · ${piezas(e.piezas)} · ${dinero(e.centavos)}`,
        );
    const fin = fechaExcel(f.semanaInicio);
    fin.setUTCDate(fin.getUTCDate() + 6);
    const fila = hoja.addRow([
      f.negocioNombre,
      fechaExcel(f.semanaInicio),
      fin,
      fechaHoraExcelMexico(f.createdAt),
      f.estadosEntregas.length,
      detalle.join('\n') || null,
      // Cancelado: en lugar del monto va el texto «Cancelado» (sin columna de estado).
      f.cancelado ? 'Cancelado' : f.total,
      f.notaCliente,
    ]);
    fila.getCell(2).numFmt = FORMATO_XLSX.fecha;
    fila.getCell(3).numFmt = FORMATO_XLSX.fecha;
    fila.getCell(4).numFmt = FORMATO_XLSX.fechaHora;
    fila.getCell(5).numFmt = FORMATO_XLSX.entero;
    fila.getCell(7).numFmt = FORMATO_XLSX.moneda;
    fila.alignment = { vertical: 'top', wrapText: true };
    fila.getCell(7).alignment = { vertical: 'top', horizontal: 'right' };
    const lineasTexto = Math.max(detalle.length, 1);
    fila.height = Math.max(18, 15 * lineasTexto + 3);
  }
  configurarImpresion(hoja);
}

const COLUMNAS_ENTREGAS = 4;
const BORDE_TOTAL = { style: 'medium' as const, color: { argb: 'FF7F7F7F' } };

/** Fila de un bloque de montos: etiqueta en A, importe en D (bajo «Monto»), con ancho completo de relleno opcional. */
function filaMonto(
  hoja: ExcelJS.Worksheet,
  etiqueta: string,
  valor: number,
  opciones: { piezas?: number; negritas?: boolean; sangria?: boolean; relleno?: boolean; bordeSuperior?: 'fino' | 'grueso' },
) {
  const r = hoja.addRow([etiqueta, opciones.piezas ?? null, null, valor]);
  r.getCell(2).numFmt = FORMATO_XLSX.entero;
  r.getCell(4).numFmt = FORMATO_XLSX.moneda;
  if (opciones.sangria) r.getCell(1).alignment = { indent: 1 };
  r.font = opciones.negritas ? { bold: true } : { italic: true, color: { argb: 'FF595959' } };
  for (let c = 1; c <= COLUMNAS_ENTREGAS; c++) {
    const celda = r.getCell(c);
    if (opciones.relleno) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FONDO_ENCABEZADO } };
    if (opciones.bordeSuperior)
      celda.border = {
        top: opciones.bordeSuperior === 'grueso' ? BORDE_TOTAL : BORDE,
        bottom: opciones.relleno ? BORDE : undefined,
      };
  }
  return r;
}

function hojaEntregas(libro: ExcelJS.Workbook, filas: FilaPedidoExcel[], lineas: LineaEntregaCliente[]) {
  const hoja = libro.addWorksheet('Entregas', { views: [{ state: 'frozen', ySplit: 1 }] });
  hoja.columns = [
    { header: 'Entrega / Producto', width: 46 },
    { header: 'Unidades', width: 12 },
    { header: 'Precio unitario', width: 16 },
    { header: 'Monto', width: 16 },
  ];
  encabezadoDeHoja(hoja);
  hoja.getCell('B1').alignment = { horizontal: 'right', vertical: 'middle' };
  hoja.getCell('C1').alignment = { horizontal: 'right', vertical: 'middle' };
  hoja.getCell('D1').alignment = { horizontal: 'right', vertical: 'middle' };

  // Por pedido (en el orden de `filas`), y dentro de cada uno sus entregas por fecha: así el bloque de cierre del pedido queda
  // junto a sus entregas. Los montos por producto son de LISTA (unidades × precio); el descuento aparece solo en los bloques.
  const folios = [...new Set(lineas.map((l) => l.folio))];
  const ordenFolios = filas.map((f) => f.folio);
  folios.sort((a, b) => ordenFolios.indexOf(a) - ordenFolios.indexOf(b));
  let totalPiezas = 0;
  let totalCent = 0;
  folios.forEach((folio, nPedido) => {
    const entregas = agruparEntregas(lineas.filter((l) => l.folio === folio));
    const importeLista = (e: EntregaAgrupada) => round2(e.lineas.reduce((s, l) => s + l.montoLista, 0));
    const fila = filas.find((f) => f.folio === folio);
    const sumaLista = round2(entregas.reduce((s, e) => s + importeLista(e), 0));
    const bloque = bloquesDePedido({
      entregas: entregas.map((e) => ({ importe: importeLista(e), fecha: e.fecha })),
      descuentoTotal: fila ? fila.descuentoTotal : 0,
      total: fila ? fila.total : sumaLista,
      porcentaje: fila ? fila.descuentoPorcentaje : null,
    });
    const conDescuento = bloque.descuento > 0;

    if (nPedido > 0) hoja.addRow([]);
    if (folios.length > 1) {
      const banda = hoja.addRow([`Pedido ${nPedido + 1}`]);
      hoja.mergeCells(banda.number, 1, banda.number, COLUMNAS_ENTREGAS);
      banda.font = { bold: true };
      for (let c = 1; c <= COLUMNAS_ENTREGAS; c++)
        banda.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FONDO_ENCABEZADO } };
    }
    entregas.forEach((e, n) => {
      if (n > 0) hoja.addRow([]); // separación clara entre entregas
      // Encabezado de la entrega: día y fecha, unidades y monto SIN descuento.
      const enc = hoja.addRow([diaLargo(e.fecha), e.piezas, null, bloque.entregas[n].subtotal]);
      enc.font = { bold: true };
      enc.getCell(2).numFmt = FORMATO_XLSX.entero;
      enc.getCell(4).numFmt = FORMATO_XLSX.moneda;
      enc.eachCell({ includeEmpty: true }, (c, col) => {
        if (col > COLUMNAS_ENTREGAS) return;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FONDO_ENTREGA } };
        c.border = { top: BORDE, bottom: BORDE };
      });
      // La nota de la entrega, una sola vez, en el encabezado (fila propia combinada, con ajuste de línea).
      if (e.nota && e.nota.trim()) {
        const nota = hoja.addRow([`Nota: ${e.nota.trim()}`]);
        hoja.mergeCells(nota.number, 1, nota.number, COLUMNAS_ENTREGAS);
        nota.alignment = { vertical: 'top', wrapText: true };
        nota.font = { italic: true };
        nota.height = Math.max(18, 15 * Math.ceil(e.nota.trim().length / 70) + 3);
      }
      for (const l of e.lineas) {
        const r = hoja.addRow([l.producto, l.unidades, l.precio, l.montoLista]);
        r.getCell(1).alignment = { indent: 1, wrapText: true, vertical: 'top' };
        r.getCell(2).numFmt = FORMATO_XLSX.entero;
        r.getCell(3).numFmt = FORMATO_XLSX.moneda;
        r.getCell(4).numFmt = FORMATO_XLSX.moneda;
      }
      // Bloque de la entrega (solo si el pedido tiene descuento; sin él, el monto del encabezado ya es el total).
      if (conDescuento) {
        const b = bloque.entregas[n];
        filaMonto(hoja, 'Subtotal', b.subtotal, { sangria: true, bordeSuperior: 'fino' });
        filaMonto(hoja, etiquetaDescuento(bloque.porcentaje), b.descuento, { sangria: true });
        filaMonto(hoja, 'Total de la entrega', b.total, { sangria: true, negritas: true });
      }
    });
    // Cierre del pedido: Subtotal / Descuento / Total (con descuento) o solo «Total del pedido».
    hoja.addRow([]);
    if (conDescuento) {
      filaMonto(hoja, 'Subtotal del pedido', bloque.subtotal, { negritas: true, relleno: true, bordeSuperior: 'grueso' });
      filaMonto(hoja, etiquetaDescuento(bloque.porcentaje), bloque.descuento, { negritas: true, relleno: true, bordeSuperior: 'fino' });
    }
    const piezasPedido = entregas.reduce((s, e) => s + e.piezas, 0);
    filaMonto(hoja, 'Total del pedido', bloque.total, {
      piezas: piezasPedido,
      negritas: true,
      relleno: true,
      bordeSuperior: conDescuento ? 'fino' : 'grueso',
    });
    totalPiezas += piezasPedido;
    totalCent += Math.round(bloque.total * 100);
  });
  if (folios.length > 1) {
    hoja.addRow([]);
    filaMonto(hoja, 'Total de la semana', totalCent / 100, {
      piezas: totalPiezas,
      negritas: true,
      relleno: true,
      bordeSuperior: 'grueso',
    });
  }
  configurarImpresion(hoja);
}

export async function libroResumenCliente(
  filas: FilaPedidoExcel[],
  lineas: LineaEntregaCliente[],
): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  hojaPedidos(libro, filas, lineas);
  hojaEntregas(libro, filas, lineas);
  return libroABuffer(libro);
}
