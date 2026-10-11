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
