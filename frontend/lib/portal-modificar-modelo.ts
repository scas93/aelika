import type { CambioEntregaPortal, DiaModificarPortal } from "./portal-api";

// Modelo puro de la pantalla «Modificar pedido» (4f): borrador por fecha, qué se manda al servidor y totales estimados.
// El servidor es la fuente de verdad (calendario, reglas, precios); esto solo arma la petición y muestra un estimado.

/** productId → cantidad. */
export type Lineas = Record<string, number>;

export interface DiaBorrador {
  /** Fecha YYYY-MM-DD. */
  fecha: string;
  /** La entrega ya existía en el pedido. */
  existia: boolean;
  lineas: Lineas;
  /** El cliente pidió quitar esta entrega. */
  quitado: boolean;
}

export type Borrador = Record<string, DiaBorrador>;

export function borradorInicial(dias: DiaModificarPortal[]): Borrador {
  const b: Borrador = {};
  for (const d of dias) {
    const lineas: Lineas = {};
    for (const p of d.entrega?.productos ?? [])
      lineas[p.productId] = (lineas[p.productId] ?? 0) + p.cantidad;
    b[d.fecha] = {
      fecha: d.fecha,
      existia: d.entrega !== null,
      lineas,
      quitado: false,
    };
  }
  return b;
}

/** Líneas con cantidad > 0 que cuentan hoy en ese día (vacío si se quitó). */
export function lineasEfectivas(d: DiaBorrador): Lineas {
  if (d.quitado) return {};
  const r: Lineas = {};
  for (const [id, c] of Object.entries(d.lineas)) if (c > 0) r[id] = c;
  return r;
}

const iguales = (a: Lineas, b: Lineas) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/** Fechas (de las editables) cuyo contenido cambió respecto al original. */
export function fechasCambiadas(
  original: Borrador,
  actual: Borrador,
  editables: Set<string>,
): string[] {
  return Object.keys(actual)
    .filter((f) => editables.has(f))
    .filter(
      (f) => !iguales(lineasEfectivas(original[f]), lineasEfectivas(actual[f])),
    )
    .sort();
}

/** Lo que se manda al servidor: solo las fechas que cambiaron; `items: []` quita la entrega. */
export function entregasAEnviar(
  original: Borrador,
  actual: Borrador,
  editables: Set<string>,
): CambioEntregaPortal[] {
  return fechasCambiadas(original, actual, editables).map((fecha) => ({
    fecha,
    items: Object.entries(lineasEfectivas(actual[fecha])).map(
      ([productId, cantidad]) => ({ productId, cantidad }),
    ),
  }));
}

/** Entregas que quedarían en el pedido (no puede quedar en cero: el cliente no cancela el pedido completo). */
export function entregasVigentes(actual: Borrador): number {
  return Object.values(actual).filter(
    (d) => Object.keys(lineasEfectivas(d)).length > 0,
  ).length;
}

export function totalesEstimados(
  actual: Borrador,
  precioDe: (productId: string) => number,
  descuentoPorcentaje: number,
) {
  let subtotal = 0;
  let piezas = 0;
  for (const d of Object.values(actual))
    for (const [id, c] of Object.entries(lineasEfectivas(d))) {
      subtotal += precioDe(id) * c;
      piezas += c;
    }
  subtotal = Math.round(subtotal * 100) / 100;
  const descuento = Math.round(subtotal * descuentoPorcentaje) / 100;
  return {
    subtotal,
    descuento,
    total: Math.round((subtotal - descuento) * 100) / 100,
    piezas,
  };
}
