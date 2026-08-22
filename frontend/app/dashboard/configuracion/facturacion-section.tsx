"use client";

import { useState } from "react";
import { ApiError, updateTenantSettings, type FacturacionModo } from "@/lib/api";

const CARD = "rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]";
const BTN_PRIMARY =
  "self-start rounded-lg bg-admin-green px-4 py-2 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40";

export default function FacturacionSection({
  token,
  facturacionModo,
  onUpdated,
}: {
  token: string;
  facturacionModo: FacturacionModo;
  onUpdated: (modo: FacturacionModo) => void;
}) {
  const [selected, setSelected] = useState<FacturacionModo>(facturacionModo);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const settings = await updateTenantSettings(token, { facturacionModo: selected });
      onUpdated(settings.facturacionModo);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la facturación");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`${CARD} flex flex-col gap-3 p-5`}>
      <div>
        <h2 className="text-sm font-extrabold text-admin-ink">Facturación</h2>
        <p className="text-sm text-admin-ink/55">
          Define si tus clientes pueden o deben pedir factura al hacer un pedido.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
        Modo de facturación
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value as FacturacionModo);
            setSaved(false);
          }}
          className="input"
        >
          <option value="DESACTIVADO">Desactivada — no se pide factura</option>
          <option value="OPCIONAL">Opcional — el cliente elige si quiere factura</option>
          <option value="OBLIGATORIO">Obligatoria — todos los pedidos deben incluirla</option>
        </select>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && !error && <p className="text-sm text-admin-green-dark">Guardado.</p>}

      <button type="submit" disabled={saving} className={BTN_PRIMARY}>
        {saving ? "Guardando..." : "Guardar"}
      </button>
    </form>
  );
}
