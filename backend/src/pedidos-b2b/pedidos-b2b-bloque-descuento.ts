import { repartirDescuento } from './pedidos-b2b-excel';

/**
 * Bloque «Subtotal / Descuento / Total» por entrega y por pedido que comparten el Excel de Históricos (hoja «Entregas») y el del
 * resumen semanal por cliente. Puro (sin base de datos). Todo en centavos enteros para que cuadre exacto:
 *  - Subtotal del pedido = suma del importe de lista de sus entregas NO canceladas.
 *  - El Total del pedido es SIEMPRE el guardado (`total`); no se recalcula.
 *  - El descuento del pedido es el guardado (`descuentoTotal`). Si Subtotal − Descuento no da el Total (dato heredado
 *    inconsistente), el descuento se deriva como Subtotal − Total (mínimo 0): el Total no cambia y el bloque siempre cuadra.
 *  - El descuento se reparte entre las entregas con `repartirDescuento` (la misma regla del export; el centavo que sobra va a la
 *    entrega de mayor importe), así Σ descuentos = descuento del pedido y Σ totales de entrega = Total del pedido.
 */

export interface BloqueMonto {
  subtotal: number;
  descuento: number;
  total: number;
}

export interface BloquePedido extends BloqueMonto {
  /** Porcentaje a mostrar: el guardado en el pedido o, si no hay (descuento heredado o monto fijo), el efectivo. 0 = sin descuento. */
  porcentaje: number;
  entregas: BloqueMonto[];
}

const aPesos = (centavos: number) => centavos / 100;
const aCentavos = (pesos: number) => Math.round(pesos * 100);

export function bloquesDePedido(p: {
  /** Entregas no canceladas, en orden de fecha. */
  entregas: { importe: number; fecha: Date }[];
  descuentoTotal: number;
  total: number;
  /** % guardado en el pedido (0 o null si no hay). */
  porcentaje: number | null;
}): BloquePedido {
  const importes = p.entregas.map((e) => aCentavos(e.importe));
  const subCent = importes.reduce((a, b) => a + b, 0);
  const totalCent = aCentavos(p.total);
  let descCent = aCentavos(p.descuentoTotal);
  if (subCent - descCent !== totalCent) descCent = Math.max(0, subCent - totalCent);
  const partes = repartirDescuento(
    aPesos(descCent),
    p.entregas.map((e, i) => ({ importe: aPesos(importes[i]), fecha: e.fecha })),
  ).map(aCentavos);
  const porcentaje =
    descCent === 0
      ? 0
      : p.porcentaje && p.porcentaje > 0
        ? p.porcentaje
        : Math.round((descCent / subCent) * 10000) / 100;
  return {
    subtotal: aPesos(subCent),
    descuento: aPesos(descCent),
    total: aPesos(subCent - descCent),
    porcentaje,
    entregas: importes.map((imp, i) => ({
      subtotal: aPesos(imp),
      descuento: aPesos(partes[i]),
      total: aPesos(imp - partes[i]),
    })),
  };
}

/** «Descuento (10%)»; el porcentaje sin ceros de sobra («10%», «7.5%», «3.33%»). */
export function etiquetaDescuento(porcentaje: number): string {
  return `Descuento (${Number(porcentaje.toFixed(2))}%)`;
}
