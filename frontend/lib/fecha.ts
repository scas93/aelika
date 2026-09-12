// Same "hoy" convention already used by the old Desde/Hasta date filter in
// Pedidos (a "YYYY-MM-DD" string, from the browser's local date, run through
// new Date(str).toISOString()) — extracted here so /dashboard (Inicio's
// summary cards) and Pedidos ("Entregados hoy") always agree on what "hoy"
// means, instead of each computing it independently. See CLAUDE.md.
export function hoyYYYYMMDD(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function rangoHoyISO(): { desde: string; hasta: string } {
  const hoy = hoyYYYYMMDD();
  return {
    desde: new Date(hoy).toISOString(),
    hasta: new Date(`${hoy}T23:59:59.999`).toISOString(),
  };
}

function fechaAYYYYMMDD(fecha: Date): string {
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const dd = String(fecha.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Same UTC-boundary conversion as rangoHoyISO — desde/hasta always go through
// a "YYYY-MM-DD" string first, never a raw local Date, so the browser's
// timezone offset never bleeds into the ISO boundary sent to the backend.
function rangoISO(desdeFecha: Date, hastaFecha: Date): { desde: string; hasta: string } {
  const desde = fechaAYYYYMMDD(desdeFecha);
  const hasta = fechaAYYYYMMDD(hastaFecha);
  return {
    desde: new Date(desde).toISOString(),
    hasta: new Date(`${hasta}T23:59:59.999`).toISOString(),
  };
}

export function rangoMesActualISO(): { desde: string; hasta: string } {
  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  return rangoISO(inicioMes, hoy);
}

export function rangoUltimos7DiasISO(): { desde: string; hasta: string } {
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6);
  return rangoISO(desde, hoy);
}

export function rangoUltimas4SemanasISO(): { desde: string; hasta: string } {
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 27);
  return rangoISO(desde, hoy);
}

export function rangoMesAnteriorISO(): { desde: string; hasta: string } {
  const hoy = new Date();
  const inicioMesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  // Day 0 of the current month is the last day of the previous month.
  const finMesAnterior = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  return rangoISO(inicioMesAnterior, finMesAnterior);
}

export type UnidadRangoRelativo = "dias" | "semanas" | "meses";

// Generalización de rangoUltimos7DiasISO/rangoUltimas4SemanasISO a
// cualquier cantidad+unidad — usada por el selector "está en los últimos N"
// del FilterBar (ver _components/FiltroFecha.tsx). Mismo cálculo de
// frontera (YYYY-MM-DD → ISO, nunca aritmética de Date cruda) que el resto
// de este archivo, para no introducir un segundo criterio de "qué día es
// hoy" — cantidad=7,dias y cantidad=4,semanas coinciden exactamente con
// rangoUltimos7DiasISO/rangoUltimas4SemanasISO (mismo offset -6/-27).
export function rangoRelativoISO(cantidad: number, unidad: UnidadRangoRelativo): { desde: string; hasta: string } {
  const hoy = new Date();
  let desde: Date;
  switch (unidad) {
    case "dias":
      desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - (cantidad - 1));
      break;
    case "semanas":
      desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - (cantidad * 7 - 1));
      break;
    case "meses":
      // Sin equivalente "mes calendario" (eso ya lo cubre rangoMesActualISO/
      // rangoMesAnteriorISO) — este es un rango rodante de N meses hacia
      // atrás desde hoy, mismo criterio "rodante" que dias/semanas arriba.
      desde = new Date(hoy.getFullYear(), hoy.getMonth() - cantidad, hoy.getDate() + 1);
      break;
  }
  return rangoISO(desde, hoy);
}
