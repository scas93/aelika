// Clases compartidas de las pantallas del portal (mismos tokens mayoreo-* que el resto de /mayoreo).
export const WRAPPER =
  "mx-auto flex w-full max-w-md flex-col gap-4 bg-mayoreo-bg px-4 pt-6 pb-8 font-mayoreo text-mayoreo-ink";
export const CARD =
  "flex flex-col gap-4 rounded-xl bg-mayoreo-card p-5 shadow-sm";
export const BTN_PRIMARIO =
  "w-full rounded-xl bg-mayoreo-button px-4 py-3 text-base font-semibold text-white transition active:opacity-80 disabled:opacity-50";
export const BTN_SECUNDARIO =
  "w-full rounded-xl border border-mayoreo-border bg-mayoreo-card px-4 py-3 text-base font-medium text-mayoreo-ink transition active:opacity-80 disabled:opacity-50";
export const BTN_ENLACE =
  "text-sm font-medium text-mayoreo-ink-soft underline disabled:no-underline disabled:opacity-60";
export const ERROR = "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700";
export const AVISO =
  "rounded-lg bg-mayoreo-accent-soft px-3 py-2 text-sm text-mayoreo-ink";
export const dinero = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    n,
  );
