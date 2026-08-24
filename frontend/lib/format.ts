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
