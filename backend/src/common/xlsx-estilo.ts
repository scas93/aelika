import type ExcelJS from 'exceljs';

/**
 * Estilo sobrio compartido por los Excel con bloques (el del resumen semanal por cliente y el de Históricos del panel):
 * fondos suaves, bordes finos, fila de títulos en negritas e impresión horizontal.
 */
export const FONDO_ENCABEZADO = 'FFF2F2F2';
export const FONDO_ENTREGA = 'FFE9EEF3';
export const BORDE = { style: 'thin' as const, color: { argb: 'FFBFBFBF' } };

/** Impresión sobria: horizontal, una hoja de ancho, fila de encabezados repetida. */
export function configurarImpresion(hoja: ExcelJS.Worksheet) {
  hoja.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:1',
    margins: {
      left: 0.4,
      right: 0.4,
      top: 0.5,
      bottom: 0.5,
      header: 0.3,
      footer: 0.3,
    },
  };
}

/** Fila 1 como fila de títulos: negritas, fondo suave y borde inferior. */
export function encabezadoDeHoja(hoja: ExcelJS.Worksheet) {
  const fila = hoja.getRow(1);
  fila.font = { bold: true };
  fila.alignment = { vertical: 'middle', wrapText: true };
  fila.height = 22;
  fila.eachCell((c) => {
    c.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: FONDO_ENCABEZADO },
    };
    c.border = { bottom: BORDE };
  });
}
