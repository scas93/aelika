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

export type Carrito = Record<string, number>; // productId → cantidad total
export type Distribucion = Record<string, Record<string, number>>; // productId → fecha → cantidad

const DIAS_ORDEN: DiaSemanaPortal[] = [
  "LUNES",
  "MARTES",
  "MIERCOLES",
  "JUEVES",
  "VIERNES",
  "SABADO",
  "DOMINGO",
];

export const round2 = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/** Total repartido en partes enteras lo más parejas posible; el resto va a las primeras fechas. */
export function repartirParejo(
  total: number,
  fechas: string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  if (fechas.length === 0) return out;
  const base = Math.floor(total / fechas.length);
  let resto = total - base * fechas.length;
  for (const f of fechas) {
    out[f] = base + (resto > 0 ? 1 : 0);
    if (resto > 0) resto -= 1;
  }
  return out;
}

export const sumaDistribucion = (
  d: Record<string, number> | undefined,
  fechas: string[],
) => fechas.reduce((s, f) => s + (d?.[f] ?? 0), 0);

/** Cada producto del carrito tiene repartida EXACTAMENTE su cantidad total entre las fechas elegidas. */
export function todoDistribuido(
  carrito: Carrito,
  dist: Distribucion,
  fechas: string[],
): boolean {
  const ids = Object.keys(carrito).filter((id) => carrito[id] > 0);
  if (ids.length === 0 || fechas.length === 0) return false;
  return ids.every((id) => sumaDistribucion(dist[id], fechas) === carrito[id]);
}

/** Entregas para el POST: una por fecha con productos de cantidad > 0. */
export function construirEntregas(
  carrito: Carrito,
  dist: Distribucion,
  fechas: string[],
): EntregaPedidoPortal[] {
  return [...fechas]
    .sort()
    .map((fecha) => ({
      fecha,
      items: Object.keys(carrito)
        .filter((id) => carrito[id] > 0 && (dist[id]?.[fecha] ?? 0) > 0)
        .map((productId) => ({ productId, cantidad: dist[productId][fecha] })),
    }))
    .filter((e) => e.items.length > 0);
}

export interface TotalesSemana {
  semanaInicio: string;
  semanaFin: string;
  fechas: string[];
  piezas: number;
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
    for (const e of delaSemana) {
      for (const it of e.items) {
        piezas += it.cantidad;
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
      subtotal,
      descuento,
      total: round2(subtotal - descuento),
      faltanPiezas:
        minimoPiezas > 0 && piezas < minimoPiezas ? minimoPiezas - piezas : 0,
    });
  }
  return out;
}

/** Días que el cliente puede elegir al CREAR un pedido (semanas sin pedido y día agregable). */
export function fechasElegibles(calendario: CalendarioPortal): string[] {
  return calendario.semanas
    .filter((s) => !s.pedido)
    .flatMap((s) =>
      s.dias
        .filter((d) => d.estado === "AGREGABLE" && d.accion === "CREAR_PEDIDO")
        .map((d) => d.fecha),
    );
}

export interface ResultadoFavorito {
  fechas: string[];
  carrito: Carrito;
  dist: Distribucion;
  avisos: string[];
}

/**
 * Aplica el favorito al PRIMER periodo sin pedido: cada día de la semana del favorito se lleva a la fecha de esa semana
 * con el mismo día. Los días que ya no cumplen el calendario y los productos que ya no están disponibles se quitan con aviso.
 * El cliente puede editar todo antes de enviar.
 */
export function aplicarFavorito(
  favorito: FavoritoPortal,
  calendario: CalendarioPortal,
  catalogo: ProductoCatalogoPortal[],
): ResultadoFavorito | null {
  if (!favorito.favorito) return null;
  const semana = calendario.semanas.find(
    (s) => !s.pedido && s.dias.some((d) => d.estado === "AGREGABLE"),
  );
  if (!semana) return null;
  const vigentes = new Set(catalogo.map((p) => p.id));
  const avisos: string[] = [];
  for (const nombre of favorito.noDisponibles)
    avisos.push(`${nombre} ya no está disponible y se quitó de tu favorito`);

  const fechaDe = new Map(
    semana.dias.map((d) => [d.diaSemana as DiaSemanaPortal, d]),
  );
  const quitados = new Set<string>();
  const carrito: Carrito = {};
  const dist: Distribucion = {};
  for (const linea of favorito.favorito.lineas) {
    if (!vigentes.has(linea.productId)) {
      avisos.push(
        `${linea.nombre} ya no está disponible y se quitó de tu favorito`,
      );
      continue;
    }
    for (const dia of DIAS_ORDEN) {
      const cantidad = linea.dias[dia] ?? 0;
      if (cantidad <= 0) continue;
      const d = fechaDe.get(dia);
      if (!d || d.estado !== "AGREGABLE") {
        quitados.add(dia);
        continue;
      }
      carrito[linea.productId] = (carrito[linea.productId] ?? 0) + cantidad;
      dist[linea.productId] = {
        ...(dist[linea.productId] ?? {}),
        [d.fecha]: cantidad,
      };
    }
  }
  for (const dia of DIAS_ORDEN.filter((x) => quitados.has(x))) {
    avisos.push(
      `El ${NOMBRE_DIA[dia]} ya no cumple el tiempo para pedir y se quitó de tu favorito`,
    );
  }
  const fechas = [
    ...new Set(Object.values(dist).flatMap((m) => Object.keys(m))),
  ].sort();
  if (fechas.length === 0) return { fechas, carrito, dist, avisos };
  return { fechas, carrito, dist, avisos };
}

const NOMBRE_DIA: Record<DiaSemanaPortal, string> = {
  LUNES: "lunes",
  MARTES: "martes",
  MIERCOLES: "miércoles",
  JUEVES: "jueves",
  VIERNES: "viernes",
  SABADO: "sábado",
  DOMINGO: "domingo",
};

/** Plantilla por día de la semana a partir de la PRIMERA semana elegida (un favorito es de una semana tipo). */
export function favoritoDesdeSeleccion(
  carrito: Carrito,
  dist: Distribucion,
  fechas: string[],
  calendario: CalendarioPortal,
): { productId: string; dias: Partial<Record<DiaSemanaPortal, number>> }[] {
  const ordenadas = [...fechas].sort();
  const primera = calendario.semanas.find((s) =>
    ordenadas.some((f) => s.dias.some((d) => d.fecha === f)),
  );
  if (!primera) return [];
  const diaDeFecha = new Map(
    primera.dias.map((d) => [d.fecha, d.diaSemana as DiaSemanaPortal]),
  );
  const lineas: {
    productId: string;
    dias: Partial<Record<DiaSemanaPortal, number>>;
  }[] = [];
  for (const id of Object.keys(carrito)) {
    const dias: Partial<Record<DiaSemanaPortal, number>> = {};
    for (const [fecha, cantidad] of Object.entries(dist[id] ?? {})) {
      const dia = diaDeFecha.get(fecha);
      if (dia && cantidad > 0) dias[dia] = cantidad;
    }
    if (Object.keys(dias).length > 0) lineas.push({ productId: id, dias });
  }
  return lineas;
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
