/**
 * Escapes a single CSV field per RFC 4180: wraps in quotes (and doubles any
 * quote inside) whenever the value contains a comma, quote, or newline.
 * Null/undefined become an empty field.
 */
function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds a CSV string (header row + one row per item) from a column list —
 * each column has a header label and a getter that pulls/formats the cell
 * value from one row. CRLF line endings per RFC 4180. Reused by any module
 * that needs a CSV export (Pedidos histórico, and Pagos next).
 */
export function toCsv<T>(items: T[], columns: { header: string; value: (item: T) => string | number | null | undefined }[]): string {
  const headerRow = columns.map((col) => escapeCsvField(col.header)).join(',');
  const rows = items.map((item) => columns.map((col) => escapeCsvField(col.value(item))).join(','));
  // UTF-8 BOM — without it, Excel on Windows opening the file via double-click
  // assumes the system codepage instead of UTF-8 and mangles accented chars.
  return '﻿' + [headerRow, ...rows].join('\r\n');
}
