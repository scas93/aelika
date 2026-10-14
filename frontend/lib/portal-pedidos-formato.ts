import { etiquetaFecha } from "./portal-calendario-formato";

// Formato de «Ver mis pedidos» (4e). Sin lógica de negocio: el servidor ya manda estado y etiquetas en español.

/** "28 sep – 4 oct" a partir de YYYY-MM-DD (sin desfase de zona). */
export function rangoSemana(inicioISO: string, finISO: string): string {
  const corto = (iso: string) =>
    new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    })
      .format(new Date(`${iso}T00:00:00Z`))
      .replace(/\./g, "");
  return `${corto(inicioISO)} – ${corto(finISO)}`;
}

/** "2 oct 2026" con la hora de Ciudad de México, para la fecha en que se marcó el pago. */
export function fechaPago(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Mexico_City",
  })
    .format(new Date(iso))
    .replace(/\./g, "");
}

/** Clases del chip de estado del pedido según su código (los códigos los define el servidor). */
export function claseChipEstado(codigo: string): string {
  switch (codigo) {
    case "CONFIRMADO_SURTIENDO":
    case "EN_PROCESO":
      return "bg-blue-50 text-blue-800";
    case "COMPLETADO":
      return "bg-green-50 text-green-800";
    case "CANCELADO":
      return "bg-red-50 text-red-700";
    default:
      return "bg-mayoreo-accent-soft text-mayoreo-ink";
  }
}

export const etiquetaFechaEntrega = etiquetaFecha;

/**
 * Ruta del portal en el host actual. En local el portal vive en `/mayoreo/{slug}`; en el host público el proxy quita el
 * prefijo y es `/{slug}`. Se toma del pathname actual para que los enlaces funcionen en ambos.
 */
export function rutaBasePortal(pathname: string, slug: string): string {
  const i = pathname.indexOf(`/${slug}`);
  return i < 0 ? `/mayoreo/${slug}` : pathname.slice(0, i + slug.length + 1);
}

/** Hoy en Ciudad de México como YYYY-MM-DD. */
export function hoyMexicoISO(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** «Esta semana» / «Próxima semana» si la semana (lunes YYYY-MM-DD) es la actual o la siguiente; null en otro caso. */
export function etiquetaSemanaRelativa(
  semanaInicio: string,
  hoy: string = hoyMexicoISO(),
): string | null {
  const dow = new Date(`${hoy}T00:00:00Z`).getUTCDay(); // 0 = domingo
  const lunes = sumarDias(hoy, -((dow + 6) % 7));
  if (semanaInicio === lunes) return "Esta semana";
  if (semanaInicio === sumarDias(lunes, 7)) return "Próxima semana";
  return null;
}

/** Orden cronológico: la semana más próxima primero (a igual semana, por folio). */
export function porSemanaAscendente<
  T extends { semanaInicio: string; folio: string },
>(pedidos: T[]): T[] {
  return [...pedidos].sort(
    (a, b) =>
      a.semanaInicio.localeCompare(b.semanaInicio) ||
      a.folio.localeCompare(b.folio),
  );
}
