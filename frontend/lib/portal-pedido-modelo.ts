import type {
  CalendarioPortal,
  DiaCalendarioPortal,
  DiaSemanaPortal,
  EntregaPedidoPortal,
  FavoritoPortal,
  ProductoCatalogoPortal,
  SemanaCalendarioPortal,
} from "./portal-api";

// Modelo del pedido que arma el cliente en el portal (4d): funciones PURAS. El servidor es la fuente de verdad (precios,
// descuento, calendario y mínimo); aquí solo se calcula lo necesario para mostrar y para armar el envío.

export const round2 = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/** Lo que el cliente captura en cada día elegido: fecha → productId → cantidad. Es la única fuente de verdad del pedido. */
export type PorDia = Record<string, Record<string, number>>;

/** Piezas de un día (suma de sus cantidades > 0). */
export const piezasDia = (lineas: Record<string, number> | undefined) =>
  Object.values(lineas ?? {}).reduce((s, n) => s + (n > 0 ? n : 0), 0);

/** Entregas para el POST: una por fecha elegida, ordenadas, solo con productos de cantidad > 0 (los días vacíos no se envían). */
export function construirEntregas(
  porDia: PorDia,
  fechas: string[],
): EntregaPedidoPortal[] {
  return [...fechas]
    .sort()
    .map((fecha) => ({
      fecha,
      items: Object.entries(porDia[fecha] ?? {})
        .filter(([, cantidad]) => cantidad > 0)
        .map(([productId, cantidad]) => ({ productId, cantidad })),
    }))
    .filter((e) => e.items.length > 0);
}

/** Días elegidos que aún no tienen ningún producto, en orden cronológico. */
export const diasVacios = (porDia: PorDia, fechas: string[]) =>
  [...fechas].sort().filter((f) => piezasDia(porDia[f]) === 0);

/** Copia las cantidades de `origen` a `destino` (reemplaza lo que hubiera en destino). */
export function copiarDia(
  porDia: PorDia,
  origen: string,
  destino: string,
): PorDia {
  const lineas: Record<string, number> = {};
  for (const [id, n] of Object.entries(porDia[origen] ?? {}))
    if (n > 0) lineas[id] = n;
  return { ...porDia, [destino]: lineas };
}

/** Pone la cantidad de un producto en un día (0 quita la línea). */
export function ponerCantidad(
  porDia: PorDia,
  fecha: string,
  productId: string,
  cantidad: number,
): PorDia {
  const lineas = { ...(porDia[fecha] ?? {}) };
  if (cantidad > 0) lineas[productId] = cantidad;
  else delete lineas[productId];
  return { ...porDia, [fecha]: lineas };
}

/** Quita del borrador los días que ya no están elegidos; los que siguen conservan sus cantidades. */
export function sinDiasQuitados(porDia: PorDia, fechas: string[]): PorDia {
  const vigentes = new Set(fechas);
  return Object.fromEntries(
    Object.entries(porDia).filter(([f]) => vigentes.has(f)),
  );
}

export interface TotalesSemana {
  semanaInicio: string;
  semanaFin: string;
  fechas: string[];
  piezas: number;
  /** Total de la semana por producto (suma de todos sus días), para que el cliente lo valide contra su necesidad. */
  productos: { productId: string; cantidad: number }[];
  subtotal: number;
  descuento: number;
  total: number;
  /** Faltan piezas para el mínimo del negocio (0 = cumple o sin mínimo). */
  faltanPiezas: number;
}

/** Totales por semana (un pedido por semana), con la misma fórmula del servidor: descuento = % del subtotal. */
export function totalesPorSemana(
  entregas: EntregaPedidoPortal[],
  semanas: SemanaCalendarioPortal[],
  precios: Record<string, number>,
  descuentoPorcentaje: number,
  minimoPiezas: number,
): TotalesSemana[] {
  const out: TotalesSemana[] = [];
  for (const semana of semanas) {
    const delaSemana = entregas.filter((e) =>
      semana.dias.some((d) => d.fecha === e.fecha),
    );
    if (delaSemana.length === 0) continue;
    let piezas = 0;
    let subtotal = 0;
    const porProducto = new Map<string, number>();
    for (const e of delaSemana) {
      for (const it of e.items) {
        piezas += it.cantidad;
        porProducto.set(
          it.productId,
          (porProducto.get(it.productId) ?? 0) + it.cantidad,
        );
        subtotal = round2(
          subtotal + (precios[it.productId] ?? 0) * it.cantidad,
        );
      }
    }
    const descuento =
      descuentoPorcentaje > 0
        ? round2(subtotal * (descuentoPorcentaje / 100))
        : 0;
    out.push({
      semanaInicio: semana.semanaInicio,
      semanaFin: semana.semanaFin,
      fechas: delaSemana.map((e) => e.fecha),
      piezas,
      productos: [...porProducto].map(([productId, cantidad]) => ({
        productId,
        cantidad,
      })),
      subtotal,
      descuento,
      total: round2(subtotal - descuento),
      faltanPiezas:
        minimoPiezas > 0 && piezas < minimoPiezas ? minimoPiezas - piezas : 0,
    });
  }
  return out;
}

/**
 * Días que el cliente YA no puede elegir y para los que tiene sentido escribirle al negocio: los que dejaron de cumplir el
 * tiempo para pedir (o están cerrados), en semanas sin pedido. Los días que simplemente ya pasaron no cuentan.
 */
export function diasCerrados(
  calendario: CalendarioPortal,
): DiaCalendarioPortal[] {
  return calendario.semanas
    .filter((s) => !s.pedido)
    .flatMap((s) => s.dias)
    .filter(
      (d) =>
        d.estado === "CERRADO" ||
        (d.estado === "NO_DISPONIBLE" && d.motivo === "ANTICIPACION_AGREGAR"),
    );
}

// ---- Favorito por día de la semana («tu lunes favorito») ----

const DIA_POR_NUMERO: DiaSemanaPortal[] = [
  "DOMINGO",
  "LUNES",
  "MARTES",
  "MIERCOLES",
  "JUEVES",
  "VIERNES",
  "SABADO",
];

const NOMBRE_DIA: Record<DiaSemanaPortal, string> = {
  LUNES: "lunes",
  MARTES: "martes",
  MIERCOLES: "miércoles",
  JUEVES: "jueves",
  VIERNES: "viernes",
  SABADO: "sábado",
  DOMINGO: "domingo",
};

/** Día de la semana de una fecha YYYY-MM-DD, sin desfase de zona. */
export const diaSemanaDeFecha = (fechaISO: string): DiaSemanaPortal =>
  DIA_POR_NUMERO[new Date(`${fechaISO}T00:00:00Z`).getUTCDay()];

/** «lunes», «miércoles»… */
export const nombreDiaSemana = (dia: DiaSemanaPortal) => NOMBRE_DIA[dia];

/** «los lunes» (lunes a viernes no cambian al plural; sábado y domingo sí). */
export const losDia = (dia: DiaSemanaPortal) => {
  const n = NOMBRE_DIA[dia];
  return `los ${n.endsWith("s") ? n : `${n}s`}`;
};

/** Cantidades del favorito para un día de la semana: productId → cantidad (> 0). Vacío si no hay favorito para ese día. */
export function favoritoDelDia(
  favorito: FavoritoPortal | null,
  dia: DiaSemanaPortal,
): Record<string, number> {
  const r: Record<string, number> = {};
  for (const l of favorito?.favorito?.lineas ?? []) {
    const n = l.dias[dia] ?? 0;
    if (n > 0) r[l.productId] = n;
  }
  return r;
}

/** Mismas líneas con las mismas cantidades (ignorando las de cantidad 0). */
export function mismasCantidades(
  a: Record<string, number> | undefined,
  b: Record<string, number> | undefined,
): boolean {
  const ka = Object.keys(a ?? {}).filter((k) => (a?.[k] ?? 0) > 0);
  const kb = Object.keys(b ?? {}).filter((k) => (b?.[k] ?? 0) > 0);
  return ka.length === kb.length && ka.every((k) => a![k] === b?.[k]);
}

/**
 * Lo que llena «Usar favorito» en un día: las cantidades del favorito de ese día de la semana sin los productos que ya no
 * están en el catálogo, con un aviso por cada producto que ya no está disponible. El servidor ya quita de `lineas` los no
 * disponibles y los nombra aparte (`noDisponibles`, de todo el favorito: no dice de qué día eran), así que esos nombres se
 * avisan también.
 */
export function usarFavoritoDia(
  favorito: FavoritoPortal,
  dia: DiaSemanaPortal,
  catalogo: ProductoCatalogoPortal[],
): { lineas: Record<string, number>; avisos: string[] } {
  const vigentes = new Set(catalogo.map((p) => p.id));
  const lineas: Record<string, number> = {};
  const fuera: string[] = [...favorito.noDisponibles];
  for (const l of favorito.favorito?.lineas ?? []) {
    const n = l.dias[dia] ?? 0;
    if (n <= 0) continue;
    if (vigentes.has(l.productId)) lineas[l.productId] = n;
    else fuera.push(l.nombre);
  }
  return {
    lineas,
    avisos: [...new Set(fuera)].map((n) => `${n} ya no está disponible`),
  };
}

/** Cuerpo de PUT /portal/favorito/dia a partir de las cantidades de un día. */
export const lineasDeFavoritoDia = (
  lineas: Record<string, number>,
): { productId: string; cantidad: number }[] =>
  Object.entries(lineas)
    .filter(([, cantidad]) => cantidad > 0)
    .map(([productId, cantidad]) => ({ productId, cantidad }));
