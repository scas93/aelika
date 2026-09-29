const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Normaliza lo no determinístico para comparar la FORMA y el resto de los
 * valores de forma estricta: ids conocidos -> etiqueta estable
 * (`etiquetas`: id -> nombre), cualquier otro UUID -> "<uuid>", fechas ISO ->
 * "<iso>". No toca claves ni el resto de los valores (Decimal sigue siendo
 * el string real que serializa la API).
 */
export function normalizar(valor: unknown, etiquetas: Record<string, string> = {}): unknown {
  if (Array.isArray(valor)) return valor.map((v) => normalizar(v, etiquetas));
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, normalizar(v, etiquetas)]));
  }
  if (typeof valor === 'string') {
    if (etiquetas[valor]) return `<${etiquetas[valor]}>`;
    if (UUID.test(valor)) return '<uuid>';
    if (ISO.test(valor)) return '<iso>';
  }
  return valor;
}

/** Claves de un objeto, ordenadas: para congelar el conjunto EXACTO de claves. */
export function claves(obj: object): string[] {
  return Object.keys(obj).sort();
}
