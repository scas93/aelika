/** Lunes (AAAA-MM-DD) de las últimas semanas, de la anterior hacia atrás: las que ofrece el selector de los botones de prueba. */

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fechaHoyMexico(ahora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

const corta = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES[m - 1]}`;
};

export interface OpcionSemana {
  inicio: string;
  etiqueta: string;
}

/** La primera es la semana anterior (la que resume el correo del lunes); el resto, hacia atrás. */
export function ultimasSemanas(cantidad = 12, ahora = new Date()): OpcionSemana[] {
  const [a, m, d] = fechaHoyMexico(ahora).split("-").map(Number);
  const hoy = new Date(Date.UTC(a, m - 1, d));
  const diasDesdeLunes = (hoy.getUTCDay() + 6) % 7;
  const lunesActual = new Date(hoy.getTime() - diasDesdeLunes * 86400000);
  return Array.from({ length: cantidad }, (_, i) => {
    const inicio = new Date(lunesActual.getTime() - (i + 1) * 7 * 86400000);
    const fin = new Date(inicio.getTime() + 6 * 86400000);
    const iso = inicio.toISOString().slice(0, 10);
    return {
      inicio: iso,
      etiqueta: `${corta(iso)} – ${corta(fin.toISOString().slice(0, 10))} ${fin.getUTCFullYear()}${i === 0 ? " (anterior)" : ""}`,
    };
  });
}
