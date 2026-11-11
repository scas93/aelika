"use client";

import { useEffect, useState } from "react";
import { ApiError, fetchTenantSettings, updateTenantSettings } from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";

// Reglas de entrega del menudeo (B2C): anticipación mínima por método y cuántos días hacia adelante puede agendar el
// cliente. 0 = sin regla / solo hoy. La anticipación se guarda en minutos y se captura con una unidad (minutos u horas). El checkout solo ofrece las opciones que las cumplen y el servidor las re-valida.
type Unidad = "min" | "h";
interface CampoTiempo {
  valor: string;
  unidad: Unidad;
}

// Muestra los minutos guardados en la unidad más natural: horas si son un múltiplo exacto de 60, si no minutos.
function deMinutos(total: number): CampoTiempo {
  return total > 0 && total % 60 === 0 ? { valor: String(total / 60), unidad: "h" } : { valor: String(total), unidad: "min" };
}

function aMinutos(c: CampoTiempo): number {
  return Math.round(Number(c.valor) * (c.unidad === "h" ? 60 : 1));
}

const MAX_MINUTOS = 10080; // 7 días

export default function ReglasEntregaSection({ token }: { token: string }) {
  const [pickup, setPickup] = useState<CampoTiempo>({ valor: "0", unidad: "min" });
  const [domicilio, setDomicilio] = useState<CampoTiempo>({ valor: "0", unidad: "min" });
  const [dias, setDias] = useState("0");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenantSettings(token)
      .then((s) => {
        setPickup(deMinutos(s.anticipacionPickupMinutos ?? 0));
        setDomicilio(deMinutos(s.anticipacionDomicilioMinutos ?? 0));
        setDias(String(s.diasMaxAgendar ?? 0));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar las reglas de entrega"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const minPickup = aMinutos(pickup);
    const minDomicilio = aMinutos(domicilio);
    if ([minPickup, minDomicilio].some((m) => !Number.isFinite(m) || m < 0 || m > MAX_MINUTOS)) {
      setError("La anticipación debe ser un tiempo entre 0 y 7 días.");
      return;
    }
    setSaving(true);
    try {
      await updateTenantSettings(token, {
        anticipacionPickupMinutos: minPickup,
        anticipacionDomicilioMinutos: minDomicilio,
        diasMaxAgendar: Number(dias),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron guardar las reglas de entrega");
    } finally {
      setSaving(false);
    }
  }

  const campoTiempo = (etiqueta: string, c: CampoTiempo, set: (c: CampoTiempo) => void) => (
    <div className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
      <label htmlFor={etiqueta}>{etiqueta}</label>
      <div className="flex gap-2">
        <input
          id={etiqueta}
          type="number"
          min={0}
          step={1}
          required
          value={c.valor}
          onChange={(e) => {
            set({ ...c, valor: e.target.value });
            setSaved(false);
          }}
          className="admin-input min-w-0 flex-1"
        />
        <select
          aria-label={`${etiqueta}: unidad`}
          value={c.unidad}
          onChange={(e) => {
            set({ ...c, unidad: e.target.value as Unidad });
            setSaved(false);
          }}
          className="admin-input w-32"
        >
          <option value="min">minutos</option>
          <option value="h">horas</option>
        </select>
      </div>
      <span className="text-xs font-normal text-admin-ink-soft">
        Ej. 15 minutos, 75 minutos (1 h 15 min), 2 horas, 24 horas. Con 0 el cliente puede pedir lo antes posible: el
        sistema siempre deja 15 minutos de margen.
      </span>
    </div>
  );

  const campoDias = (etiqueta: string, ayuda: string, valor: string, set: (v: string) => void, max: number) => (
    <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
      {etiqueta}
      <input
        type="number"
        min={0}
        max={max}
        step={1}
        required
        value={valor}
        onChange={(e) => {
          set(e.target.value);
          setSaved(false);
        }}
        className="admin-input"
      />
      <span className="text-xs font-normal text-admin-ink-soft">{ayuda}</span>
    </label>
  );

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-admin-ink">Reglas de entrega</h2>
          <p className="text-sm text-admin-ink-soft">
            Define con cuánta anticipación deben pedir tus clientes y cuántos días pueden elegir.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-admin-ink-soft">Cargando...</p>
        ) : (
          <>
            {campoTiempo("Anticipación mínima para pickup", pickup, setPickup)}
            {campoTiempo("Anticipación mínima para envío a domicilio", domicilio, setDomicilio)}
            {campoDias(
              "Días disponibles para agendar",
              "Cuántos días se ofrecen contando desde el primer día disponible (ej. con 48 h de anticipación, desde pasado mañana). 0 = solo ese día.",
              dias,
              setDias,
              30,
            )}
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && !error && <p className="text-sm text-admin-green-dark">Guardado.</p>}

        <Button type="submit" disabled={saving || loading} className="self-start">
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </form>
    </Card>
  );
}
