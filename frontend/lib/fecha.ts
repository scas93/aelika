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
