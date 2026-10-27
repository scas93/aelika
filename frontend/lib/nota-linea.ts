// Nota por producto (solo B2C). Espejo de backend/src/common/nota-linea.ts: el backend es la fuente de verdad y aplica
// la misma normalización y el mismo tope; si cambia allá, hay que actualizar esto a mano (el frontend no puede importar
// código del backend).
export const NOTA_LINEA_MAX = 140;

/** Quita espacios al inicio/final, colapsa espacios repetidos y reemplaza saltos de línea por un espacio. "" = sin nota. */
export function normalizarNotaLinea(valor: string): string {
  return valor.replace(/\s+/g, " ").trim();
}

/** Largo en caracteres (puntos de código): un emoji cuenta 1, igual que en el backend. */
export function longitudNota(valor: string): number {
  return [...valor].length;
}

/** Recorta a NOTA_LINEA_MAX caracteres (puntos de código) sin partir un emoji por la mitad. */
export function recortarNota(valor: string): string {
  const chars = [...valor];
  return chars.length <= NOTA_LINEA_MAX ? valor : chars.slice(0, NOTA_LINEA_MAX).join("");
}
