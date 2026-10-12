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
