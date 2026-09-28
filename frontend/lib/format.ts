export const MONEY_FORMATTER = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

export function formatMoney(value: string | number): string {
  return MONEY_FORMATTER.format(Number(value));
}

// Same approach already used inline in pedidos/page.tsx for the order card's
// date display.
export function formatFechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Cliente.telefono llega del backend ya normalizado (solo dígitos, ver
// normalizarTelefono) — esto es puramente de presentación, no cambia el
// dato guardado. Agrupa 10 dígitos como "55 1234 5678" (lada + 4 + 4, el
// patrón visual más común en México); si no son exactamente 10 (número
// corto/mal capturado, ver ese mismo comentario en el backend) se muestra
// tal cual, sin forzar un agrupamiento que no aplica.
export function formatTelefono(telefono: string): string {
  if (telefono.length !== 10) return telefono;
  return `${telefono.slice(0, 2)} ${telefono.slice(2, 6)} ${telefono.slice(6)}`;
}

// Fecha corta sin hora ("28 sept"; "14 ago 2025" si no es del año en curso)
// — el año solo aparece cuando hace falta para no ser ambiguo. Siempre en
// America/Mexico_City (misma zona que usa el backend, ver fechaEnMexico),
// no en la del navegador: así el día mostrado es el mismo "día" con el que
// el backend decide "1 sello por día", sin importar dónde se abra el panel.
const ZONA_NEGOCIO = "America/Mexico_City";
const FECHA_CORTA = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: ZONA_NEGOCIO });
const FECHA_CORTA_CON_ANIO = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: ZONA_NEGOCIO,
});
const ANIO = new Intl.DateTimeFormat("es-MX", { year: "numeric", timeZone: ZONA_NEGOCIO });

export function formatFechaCorta(iso: string, ahora: Date = new Date()): string {
  const fecha = new Date(iso);
  const mismoAnio = ANIO.format(fecha) === ANIO.format(ahora);
  return (mismoAnio ? FECHA_CORTA : FECHA_CORTA_CON_ANIO).format(fecha);
}
