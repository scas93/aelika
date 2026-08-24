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
