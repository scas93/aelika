import type {
  DiaCalendarioPortal,
  EstadoDiaPortal,
  MotivoDiaPortal,
} from "./portal-api";

// Formato del calendario del portal (4c). Todo en hora de Ciudad de México; el cálculo vive en el backend.
const ZONA = "America/Mexico_City";

export const ETIQUETA_ESTADO: Record<EstadoDiaPortal, string> = {
  AGREGABLE: "Disponible",
  MODIFICABLE: "Puedes modificarlo",
  CERRADO: "Cerrado",
  NO_DISPONIBLE: "No disponible",
};

export const ETIQUETA_MOTIVO: Record<MotivoDiaPortal, string> = {
  PASADO: "Ya pasó",
  ANTICIPACION_AGREGAR: "Ya no hay tiempo para pedirlo",
  ANTICIPACION_MODIFICAR: "Ya no hay tiempo para modificarlo",
  ENTREGA_CERRADA: "Entrega cerrada",
  PEDIDO_PAGADO: "Pedido pagado",
};

const DIA = new Intl.DateTimeFormat("es-MX", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const MOMENTO = new Intl.DateTimeFormat("es-MX", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: ZONA,
});

/**
 * "Lun 5 de oct" a partir de YYYY-MM-DD (sin desfase de zona): mayúscula solo en la primera letra del día; el resto, en
 * minúsculas. No usar `capitalize` de CSS en estos textos: pondría también "De" y "Oct" en mayúscula.
 */
export function etiquetaFecha(fechaISO: string): string {
  const t = DIA.format(new Date(`${fechaISO}T00:00:00Z`)).replace(/\./g, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "Jue 15 oct" (sin «de») a partir de YYYY-MM-DD, sin desfase de zona. */
export function etiquetaFechaCorta(fechaISO: string): string {
  const partes = DIA.formatToParts(new Date(`${fechaISO}T00:00:00Z`));
  const v = (t: string) =>
    (partes.find((p) => p.type === t)?.value ?? "").replace(/\./g, "");
  const dia = v("weekday");
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${v("day")} ${v("month")}`;
}

/** "Lun 19" (día de la semana abreviado y número) para las pestañas por día. */
export function etiquetaTabDia(fechaISO: string): string {
  const [dia, num] = etiquetaFechaCorta(fechaISO).split(" ");
  return `${dia} ${num}`;
}

/** "vie, 2 oct, 20:00" en hora de Ciudad de México. */
export function etiquetaMomento(iso: string): string {
  return MOMENTO.format(new Date(iso));
}

/** Texto de la hora límite de un día, o null si no aplica. */
export function textoLimite(dia: DiaCalendarioPortal): string | null {
  if (!dia.limiteAt) return null;
  const cuando = etiquetaMomento(dia.limiteAt);
  return dia.estado === "AGREGABLE" || dia.estado === "MODIFICABLE"
    ? `Hasta ${cuando}`
    : `Cerró ${cuando}`;
}

const PARTES_LIMITE = new Intl.DateTimeFormat("es-MX", {
  weekday: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: ZONA,
});

/** "sáb 17, 8:00 pm" (12 horas, hora de Ciudad de México) a partir del instante límite. */
function momento12(iso: string): string {
  const partes = PARTES_LIMITE.formatToParts(new Date(iso));
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const hora = Number(v("hour"));
  const sufijo = hora >= 12 ? "pm" : "am";
  return `${v("weekday").replace(/\./g, "")} ${v("day")}, ${hora % 12 || 12}:${v("minute")} ${sufijo}`;
}

/** "Cambia antes del mié 14, 2:00 pm". */
export function textoCambiaAntes(iso: string): string {
  return `Cambia antes del ${momento12(iso)}`;
}

/** "Agrega antes del jue 15, 8:00 pm". */
export function textoAgregaAntes(iso: string): string {
  return `Agrega antes del ${momento12(iso)}`;
}

/** "08:00" → "8:00 am", "18:30" → "6:30 pm" (12 horas). */
export function hora12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

const MES_CORTO = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/** "19–25 oct", o "26 oct – 1 nov" si la semana cruza de mes. Recibe YYYY-MM-DD (sin desfase de zona). */
export function rangoSemanaCorto(inicio: string, fin: string): string {
  const [, mi, di] = inicio.split("-").map(Number);
  const [, mf, df] = fin.split("-").map(Number);
  return mi === mf
    ? `${di}–${df} ${MES_CORTO[mi - 1]}`
    : `${di} ${MES_CORTO[mi - 1]} – ${df} ${MES_CORTO[mf - 1]}`;
}

/** wa.me del número de atención (10 dígitos nacionales) con un texto opcional; null si no hay número. */
export function enlaceContacto(
  numeroAtencion: string | null,
  texto?: string,
): string | null {
  if (!numeroAtencion || !/^\d{10}$/.test(numeroAtencion)) return null;
  const base = `https://wa.me/52${numeroAtencion}`;
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base;
}

const FECHA_LARGA = new Intl.DateTimeFormat("es-MX", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** "lunes 19 de octubre" a partir de YYYY-MM-DD (sin desfase de zona y sin la coma que agrega Intl). */
export function etiquetaFechaLarga(fechaISO: string): string {
  const partes = FECHA_LARGA.formatToParts(new Date(`${fechaISO}T00:00:00Z`));
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${v("weekday")} ${v("day")} de ${v("month")}`;
}

export type ContextoContacto =
  | { tipo: "dia"; cliente: string; fecha: string } // día cerrado (fecha YYYY-MM-DD)
  | { tipo: "pedido"; cliente: string; folios: string[] } // confirmación de pedido
  | { tipo: "general"; cliente: string }; // menú y cualquier otro lugar

/** Texto precargado del mensaje de WhatsApp según el contexto, con el nombre del cliente de la sesión. */
export function mensajeContacto(c: ContextoContacto): string {
  switch (c.tipo) {
    case "dia":
      return `Hola, soy ${c.cliente}. Quiero cambiar mi entrega del ${etiquetaFechaLarga(c.fecha)}.`;
    case "pedido":
      return `Hola, soy ${c.cliente}, sobre mi pedido ${c.folios.join(" y ")}.`;
    default:
      return `Hola, soy ${c.cliente}, necesito ayuda con mi pedido.`;
  }
}
