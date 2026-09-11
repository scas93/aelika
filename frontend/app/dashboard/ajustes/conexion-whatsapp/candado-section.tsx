"use client";

import { useState } from "react";
import { ApiError, updateTenantSettings } from "@/lib/api";
import Card from "../../_components/Card";
import Button from "../../_components/Button";

const DEFAULT_DIAS = 7;

// No tiene nada que ver con el webhook de arriba, pero vive en la misma
// pantalla porque las 3 cosas son "configuración de la conexión con
// Botpress" en sentido amplio — ver comentario del prompt sobre por qué se
// etiqueta explícito para no confundirlas.
export default function CandadoSection({
  token,
  candadoMarketingDias,
  onSaved,
}: {
  token: string;
  candadoMarketingDias: number | null;
  onSaved: (dias: number | null) => void;
}) {
  const [dias, setDias] = useState(String(candadoMarketingDias ?? DEFAULT_DIAS));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const numero = Number(dias);
    if (!Number.isInteger(numero) || numero <= 0) return;

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateTenantSettings(token, { candadoMarketingDias: numero });
      onSaved(numero);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el candado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-extrabold text-admin-ink">Candado de frecuencia</h2>
        <p className="text-sm text-admin-ink-soft">
          Días mínimos entre dos mensajes de <strong>Recontacto</strong> (categoría Marketing) al mismo cliente —
          evita saturarlo. No aplica a los mensajes de <strong>Seguimiento</strong>, que nunca tienen candado.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
        Días entre envíos
        <input
          type="number"
          min="1"
          step="1"
          value={dias}
          onChange={(e) => setDias(e.target.value)}
          placeholder={String(DEFAULT_DIAS)}
          className="admin-input w-32"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving} className="self-start">
        {saving ? "Guardando..." : saved ? "Guardado" : "Guardar"}
      </Button>
    </Card>
  );
}
