"use client";

import { useState } from "react";
import { ApiError, updateTenantSettings } from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";

/** Mínimo de piezas por pedido de mayoreo (Dueño). 0 = sin mínimo: ninguna pantalla muestra la barra de mínimo. */
export default function MinimoPiezasB2bSection({
  token,
  minimoPiezas,
  onUpdated,
}: {
  token: string;
  minimoPiezas: number;
  onUpdated: (minimo: number) => void;
}) {
  const [valor, setValor] = useState(String(minimoPiezas));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numero = Number(valor);
  const valido = valor.trim() !== "" && Number.isInteger(numero) && numero >= 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const settings = await updateTenantSettings(token, { pedidoB2bMinimoPiezas: numero });
      onUpdated(settings.pedidoB2bMinimoPiezas);
      setValor(String(settings.pedidoB2bMinimoPiezas));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el mínimo de piezas");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-admin-ink">Mínimo de piezas por pedido</h2>
          <p className="text-sm text-admin-ink-soft">
            Cantidad mínima de piezas que debe sumar un pedido de mayoreo para poder confirmarse. Escribe 0 si no quieres
            mínimo: no se mostrará ninguna barra ni aviso de mínimo. Los pedidos ya creados conservan el mínimo que tenían.
          </p>
        </div>

        <label className="flex max-w-[220px] flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Piezas mínimas
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={valor}
            onChange={(e) => {
              setValor(e.target.value);
              setSaved(false);
              setError(null);
            }}
            className="admin-input"
          />
        </label>
        {!valido && <p className="text-sm text-red-600">Escribe un número entero de 0 en adelante.</p>}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && !error && <p className="text-sm text-admin-green-dark">Guardado.</p>}

        <Button type="submit" disabled={saving || !valido} className="self-start">
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </form>
    </Card>
  );
}
