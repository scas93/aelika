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
