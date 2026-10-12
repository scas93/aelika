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

/** "lun, 5 oct" a partir de YYYY-MM-DD (sin desfase de zona). */
export function etiquetaFecha(fechaISO: string): string {
  return DIA.format(new Date(`${fechaISO}T00:00:00Z`));
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
