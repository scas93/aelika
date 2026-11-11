"use client";

import { useEffect, useState } from "react";
import { ApiError, fetchTenantSettings, updateTenantSettings } from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";

// Reglas de entrega del menudeo (B2C): anticipación mínima por método y cuántos días hacia adelante puede agendar el
// cliente. 0 = sin regla / solo hoy. El checkout solo ofrece las opciones que las cumplen y el servidor las re-valida.
export default function ReglasEntregaSection({ token }: { token: string }) {
  const [pickup, setPickup] = useState("0");
  const [domicilio, setDomicilio] = useState("0");
  const [dias, setDias] = useState("0");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenantSettings(token)
      .then((s) => {
        setPickup(String(s.anticipacionPickupHoras ?? 0));
        setDomicilio(String(s.anticipacionDomicilioHoras ?? 0));
        setDias(String(s.diasMaxAgendar ?? 0));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar las reglas de entrega"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await updateTenantSettings(token, {
        anticipacionPickupHoras: Number(pickup),
        anticipacionDomicilioHoras: Number(domicilio),
        diasMaxAgendar: Number(dias),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron guardar las reglas de entrega");
    } finally {
      setSaving(false);
    }
  }

  const campo = (
    etiqueta: string,
    ayuda: string,
    valor: string,
    set: (v: string) => void,
    max: number,
  ) => (
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
            {campo("Anticipación mínima para pickup (horas)", "0 = sin regla (mínimo 15 minutos).", pickup, setPickup, 168)}
            {campo(
              "Anticipación mínima para envío a domicilio (horas)",
              "0 = sin regla (mínimo 15 minutos).",
              domicilio,
              setDomicilio,
              168,
            )}
            {campo(
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
