import { registerDecorator, type ValidationOptions } from 'class-validator';

/** Tope de la nota por producto, en caracteres (puntos de código, no unidades UTF-16: un emoji cuenta 1). */
export const NOTA_LINEA_MAX = 140;

/**
 * Normaliza la nota por producto: quita espacios al inicio y al final, colapsa espacios repetidos y reemplaza saltos
 * de línea y tabuladores por un espacio. Vacía tras normalizar = sin nota (null). La tienda aplica la misma regla
 * (frontend/lib/nota-linea.ts); el backend es la fuente de verdad.
 */
export function normalizarNotaLinea(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null;
  const limpia = valor.replace(/\s+/g, ' ').trim();
  return limpia === '' ? null : limpia;
}

export function longitudNota(nota: string): number {
  return [...nota].length;
}

/** class-validator: la nota (ya normalizada por el @Transform del DTO) no excede NOTA_LINEA_MAX caracteres. */
export function NotaLineaMaxima(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'notaLineaMaxima',
      target: object.constructor,
      propertyName,
      options: { message: `La nota del producto admite máximo ${NOTA_LINEA_MAX} caracteres`, ...options },
      validator: {
        validate: (value: unknown) => typeof value !== 'string' || longitudNota(value) <= NOTA_LINEA_MAX,
      },
    });
  };
}
