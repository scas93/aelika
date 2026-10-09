import ExcelJS from 'exceljs';

/** Tipo de dato de una columna: define el formato de celda (números y fechas reales, no texto). */
export type TipoColumnaXlsx = 'texto' | 'entero' | 'decimal' | 'moneda' | 'fecha' | 'fechaHora';

export interface ColumnaXlsx<T> {
  encabezado: string;
  tipo: TipoColumnaXlsx;
  ancho?: number;
  valor: (fila: T) => string | number | Date | null | undefined;
}

const FORMATO: Record<Exclude<TipoColumnaXlsx, 'texto'>, string> = {
  entero: '#,##0',
  decimal: '0.##',
  moneda: '"$"#,##0.00',
  fecha: 'dd/mm/yyyy',
  fechaHora: 'dd/mm/yyyy hh:mm',
};

/** Agrega una hoja: encabezado en negritas, fila fija al hacer scroll y autofiltro. Montos/cantidades quedan numéricos. */
export function agregarHoja<T>(libro: ExcelJS.Workbook, nombre: string, columnas: ColumnaXlsx<T>[], filas: T[]): ExcelJS.Worksheet {
  const hoja = libro.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
  hoja.columns = columnas.map((c) => ({ header: c.encabezado, width: c.ancho ?? Math.max(12, c.encabezado.length + 4) }));
  hoja.getRow(1).font = { bold: true };

  for (const fila of filas) {
    const row = hoja.addRow(columnas.map((c) => c.valor(fila) ?? null));
    columnas.forEach((c, i) => {
      if (c.tipo !== 'texto') row.getCell(i + 1).numFmt = FORMATO[c.tipo];
    });
  }
  if (columnas.length > 0) {
    hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
  }
  return hoja;
}

export async function libroABuffer(libro: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await libro.xlsx.writeBuffer());
}

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Fecha sin hora (YYYY-MM-DD) como fecha de Excel (medianoche UTC: Excel no guarda zona horaria). */
export function fechaExcel(ymd: string | Date): Date {
  const s = typeof ymd === 'string' ? ymd : ymd.toISOString().slice(0, 10);
  return new Date(`${s}T00:00:00.000Z`);
}

/** Instante → hora de pared de Ciudad de México, guardada como fecha de Excel (que no maneja zonas horarias). */
export function fechaHoraExcelMexico(d: Date): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)));
}
