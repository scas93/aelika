import Card from "./Card";

// Compartida entre page.tsx (Inicio B2C) e inicio-b2b.tsx (Inicio B2B) —
// misma tarjeta de número simple en ambas variantes.
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
    <Card className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-admin-ink-soft">{label}</span>
      {error ? (
        <span className="text-sm text-red-600">No se pudo cargar</span>
      ) : (
        <span className="text-[30px] font-bold text-admin-ink">{value ?? "—"}</span>
      )}
    </Card>
  );
}
