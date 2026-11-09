/**
 * «Cambios desde la última revisión» (B2B, solo panel). Funciones puras: arman la referencia (copia del pedido antes de la
 * primera modificación del cliente) y calculan la diferencia contra el pedido actual. Se compara por CANTIDADES, nunca por
 * precios: si lo único distinto es el total, se avisa como actualización de precios y no se inventan cambios de productos.
 * Las notas y el pago de las entregas no se comparan.
 */

export interface LineaReferencia {
  productId: string | null;
  nombreProducto: string;
  cantidad: number;
}

export interface EntregaReferencia {
  /** "YYYY-MM-DD". */
  fecha: string;
  lineas: LineaReferencia[];
}

export interface ReferenciaPedido {
  /** Total con dos decimales, como texto. */
  total: string;
  notaCliente: string | null;
  entregas: EntregaReferencia[];
}

/** Lo mínimo del pedido que hace falta (lo cumplen tanto INCLUDE_PEDIDO_ADMIN como la lectura de la edición del portal). */
export interface OrdenParaReferencia {
  total: { toString(): string } | number | string;
  detalleB2b: { notaCliente: string | null } | null;
  items: {
    productId: string | null;
    nombreProducto: string;
    orden: number;
    id: string;
    entregaItems: { entregaId: string; cantidad: number }[];
  }[];
  entregas?: { id: string; fecha: Date; estado: string }[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const claveLinea = (l: { productId: string | null; nombreProducto: string }) =>
  l.productId ?? `nombre:${l.nombreProducto}`;
const centavos = (v: { toString(): string } | number | string) =>
  Math.round(Number(v.toString()) * 100);
const dosDecimales = (v: { toString(): string } | number | string) =>
  (centavos(v) / 100).toFixed(2);
const notaNormal = (n: string | null | undefined) => n?.trim() || null;

/** Estado del pedido tal como está HOY (entregas vigentes, no canceladas) en la forma de la referencia. */
export function armarReferencia(orden: OrdenParaReferencia): ReferenciaPedido {
  const vigentes = (orden.entregas ?? []).filter(
    (e) => e.estado !== 'CANCELADA',
  );
  const items = [...orden.items].sort((a, b) => a.orden - b.orden);
  const entregas = vigentes
    .map((e) => ({
      fecha: iso(e.fecha),
      lineas: items.flatMap((i) =>
        i.entregaItems
          .filter((ei) => ei.entregaId === e.id)
          .map((ei) => ({
            productId: i.productId,
            nombreProducto: i.nombreProducto,
            cantidad: ei.cantidad,
          })),
      ),
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  return {
    total: dosDecimales(orden.total),
    notaCliente: notaNormal(orden.detalleB2b?.notaCliente),
    entregas,
  };
}

export type TipoLineaCambio = 'NUEVO' | 'CAMBIO' | 'ELIMINADO';
export interface LineaCambio {
  productId: string | null;
  nombreProducto: string;
  tipo: TipoLineaCambio;
  /** null si el producto es nuevo en la entrega. */
  antes: number | null;
  /** null si el producto se quitó de la entrega. */
  despues: number | null;
}

export type TipoEntregaCambio = 'NUEVA' | 'ELIMINADA' | 'MOVIDA' | 'MODIFICADA';
export interface EntregaCambio {
  tipo: TipoEntregaCambio;
  /** Fecha de la entrega en el pedido actual; en una ELIMINADA, la que tenía. */
  fecha: string;
  /** Solo en MOVIDA: la fecha donde estaba. */
  fechaAnterior?: string;
  /** Piezas de la entrega (NUEVA, ELIMINADA y MOVIDA). */
  piezas: number;
  /** MODIFICADA: solo las líneas distintas. NUEVA: todas. ELIMINADA: todas. MOVIDA: vacío. */
  lineas: LineaCambio[];
}

export interface CambiosPedido {
  entregas: EntregaCambio[];
  nota: 'NUEVA' | 'MODIFICADA' | 'QUITADA' | null;
  /** Presente solo si el total cambió. */
  total: { antes: string; despues: string } | null;
  /** El total cambió y NO hay ninguna diferencia de entregas, productos, cantidades ni nota. */
  soloPrecios: boolean;
  /** Pedido igual que la referencia (mismas cantidades, nota y total). */
  sinDiferencias: boolean;
}

const piezasDe = (lineas: LineaReferencia[]) =>
  lineas.reduce((s, l) => s + l.cantidad, 0);
/** Firma del contenido de una entrega (para detectar una entrega movida de día). */
const firma = (lineas: LineaReferencia[]) =>
  lineas
    .map((l) => `${claveLinea(l)}:${l.cantidad}`)
    .sort()
    .join('|');

function lineasDe(
  antes: LineaReferencia[],
  despues: LineaReferencia[],
): LineaCambio[] {
  const previo = new Map(antes.map((l) => [claveLinea(l), l]));
  const actual = new Map(despues.map((l) => [claveLinea(l), l]));
  const out: LineaCambio[] = [];
  for (const l of despues) {
    const p = previo.get(claveLinea(l));
    if (!p)
      out.push({
        productId: l.productId,
        nombreProducto: l.nombreProducto,
        tipo: 'NUEVO',
        antes: null,
        despues: l.cantidad,
      });
    else if (p.cantidad !== l.cantidad)
      out.push({
        productId: l.productId,
        nombreProducto: l.nombreProducto,
        tipo: 'CAMBIO',
        antes: p.cantidad,
        despues: l.cantidad,
      });
  }
  for (const l of antes)
    if (!actual.has(claveLinea(l)))
      out.push({
        productId: l.productId,
        nombreProducto: l.nombreProducto,
        tipo: 'ELIMINADO',
        antes: l.cantidad,
        despues: null,
      });
  return out;
}

export function calcularCambios(
  referencia: ReferenciaPedido,
  actual: ReferenciaPedido,
): CambiosPedido {
  const previas = new Map(referencia.entregas.map((e) => [e.fecha, e]));
  const actuales = new Map(actual.entregas.map((e) => [e.fecha, e]));

  const eliminadas = referencia.entregas.filter((e) => !actuales.has(e.fecha));
  const nuevas = actual.entregas.filter((e) => !previas.has(e.fecha));

  const cambios: EntregaCambio[] = [];

  // Una entrega eliminada y una nueva con exactamente el mismo contenido son una entrega movida de día.
  const eliminadasLibres = [...eliminadas];
  for (const nueva of nuevas) {
    const f = firma(nueva.lineas);
    const i =
      nueva.lineas.length > 0
        ? eliminadasLibres.findIndex((e) => firma(e.lineas) === f)
        : -1;
    if (i >= 0) {
      const [vieja] = eliminadasLibres.splice(i, 1);
      cambios.push({
        tipo: 'MOVIDA',
        fecha: nueva.fecha,
        fechaAnterior: vieja.fecha,
        piezas: piezasDe(nueva.lineas),
        lineas: [],
      });
    } else {
      cambios.push({
        tipo: 'NUEVA',
        fecha: nueva.fecha,
        piezas: piezasDe(nueva.lineas),
        lineas: lineasDe([], nueva.lineas),
      });
    }
  }
  for (const vieja of eliminadasLibres)
    cambios.push({
      tipo: 'ELIMINADA',
      fecha: vieja.fecha,
      piezas: piezasDe(vieja.lineas),
      lineas: lineasDe(vieja.lineas, []),
    });
  for (const e of actual.entregas) {
    const p = previas.get(e.fecha);
    if (!p) continue;
    const lineas = lineasDe(p.lineas, e.lineas);
    if (lineas.length > 0)
      cambios.push({
        tipo: 'MODIFICADA',
        fecha: e.fecha,
        piezas: piezasDe(e.lineas),
        lineas,
      });
  }
  cambios.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const notaAntes = notaNormal(referencia.notaCliente);
  const notaDespues = notaNormal(actual.notaCliente);
  const nota =
    notaAntes === notaDespues
      ? null
      : notaAntes === null
        ? 'NUEVA'
        : notaDespues === null
          ? 'QUITADA'
          : 'MODIFICADA';

  const totalCambio = centavos(referencia.total) !== centavos(actual.total);
  const sinCambiosDeContenido = cambios.length === 0 && nota === null;
  return {
    entregas: cambios,
    nota,
    total: totalCambio
      ? {
          antes: dosDecimales(referencia.total),
          despues: dosDecimales(actual.total),
        }
      : null,
    soloPrecios: totalCambio && sinCambiosDeContenido,
    sinDiferencias: !totalCambio && sinCambiosDeContenido,
  };
}
