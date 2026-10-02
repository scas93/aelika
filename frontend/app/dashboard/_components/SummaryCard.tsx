import Card from "./Card";

// Compartida entre page.tsx (Inicio B2C) e inicio-b2b.tsx (Inicio B2B) —
// misma tarjeta de número simple en ambas variantes.
// Columnas por ancho del contenedor (no por breakpoint de viewport): el <main>
// del dashboard tiene max-w fijo y una sidebar, así que el ancho útil no
// depende de la pantalla. Cada card pide al menos 220px (cabe "$125,430.50" a 30px); si no caben, baja de fila.
export const SUMMARY_GRID =
  "grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4";

export default function SummaryCard({
  label,
  value,
  error,
}: {
  label: string;
  value: string | number | undefined;
  error: string | null;
}) {
  return (
    <Card padding={20} className="flex min-w-0 flex-col gap-1.5">
      <span className="min-h-[2.5em] text-[13px] leading-[1.25] font-semibold text-admin-ink-soft [overflow-wrap:anywhere]">{label}</span>
      {error ? (
        <span className="mt-auto text-sm text-admin-red">No se pudo cargar</span>
      ) : (
        <span className="mt-auto text-[30px] leading-tight font-bold text-admin-ink [overflow-wrap:anywhere]">{value ?? "—"}</span>
      )}
    </Card>
  );
}
