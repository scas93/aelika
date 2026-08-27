"use client";

import { useState } from "react";
import {
  ApiError,
  updateTenantSettings,
  DIAS_SEMANA_PEDIDO_B2B,
  type DiaSemanaPedidoB2b,
  type VentanaRecepcionB2b,
} from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";

const ORDEN_DIAS = DIAS_SEMANA_PEDIDO_B2B.map((dia) => dia.value);

function indiceDia(dia: DiaSemanaPedidoB2b): number {
  return ORDEN_DIAS.indexOf(dia);
}

const VENTANA_DEFAULT: VentanaRecepcionB2b = {
  aperturaDia: "LUNES",
  aperturaHora: "08:00",
  cierreDia: "VIERNES",
  cierreHora: "18:00",
};

export default function VentanaRecepcionB2bSection({
  token,
  ventanaRecepcionB2b,
  onUpdated,
}: {
  token: string;
  ventanaRecepcionB2b: VentanaRecepcionB2b | null;
  onUpdated: (ventana: VentanaRecepcionB2b | null) => void;
}) {
  // El checkbox + los valores prellenados ya reflejan el estado actual
  // (configurada vs. sin configurar) desde el primer render, no solo tras
  // guardar.
  const [activa, setActiva] = useState(ventanaRecepcionB2b !== null);
  const [ventana, setVentana] = useState<VentanaRecepcionB2b>(ventanaRecepcionB2b ?? VENTANA_DEFAULT);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function actualizar(patch: Partial<VentanaRecepcionB2b>) {
    setVentana((prev) => ({ ...prev, ...patch }));
    setSaved(false);
    setError(null);
  }

  // Mismas reglas que normalizarVentanaRecepcion en el backend (ver
  // common/ventana-recepcion-b2b.ts) — feedback antes de enviar, el servidor
  // sigue siendo quien valida de verdad.
  function validar(): string | null {
    if (!activa) return null;

    const aperturaIndex = indiceDia(ventana.aperturaDia);
    const cierreIndex = indiceDia(ventana.cierreDia);

    if (aperturaIndex > cierreIndex) {
      return "El día de apertura debe ser igual o anterior al día de cierre dentro de la semana — no se soportan ventanas que crucen domingo→lunes.";
    }
    if (aperturaIndex === cierreIndex && ventana.aperturaHora >= ventana.cierreHora) {
      return "La hora de apertura debe ser antes que la de cierre cuando ambos días son el mismo.";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const validacion = validar();
    if (validacion) {
      setError(validacion);
      return;
    }

    setSaving(true);
    try {
      const settings = await updateTenantSettings(token, {
        ventanaRecepcionB2b: activa ? ventana : null,
      });
      onUpdated(settings.ventanaRecepcionB2b);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la ventana de recepción");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-admin-ink">Ventana de recepción de pedidos</h2>
          <p className="text-sm text-admin-ink-soft">
            Define el rango semanal en el que tu storefront de mayoreo acepta pedidos nuevos. Sin ventana configurada,
            se aceptan en cualquier momento.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm font-semibold text-admin-ink">
          <input
            type="checkbox"
            checked={activa}
            onChange={(e) => {
              setActiva(e.target.checked);
              setSaved(false);
              setError(null);
            }}
          />
          Restringir la recepción a una ventana semanal
        </label>

        {activa && (
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Apertura
              <div className="flex gap-2">
                <select
                  value={ventana.aperturaDia}
                  onChange={(e) => actualizar({ aperturaDia: e.target.value as DiaSemanaPedidoB2b })}
                  className="admin-input"
                >
                  {DIAS_SEMANA_PEDIDO_B2B.map((dia) => (
                    <option key={dia.value} value={dia.value}>
                      {dia.label}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  value={ventana.aperturaHora}
                  onChange={(e) => actualizar({ aperturaHora: e.target.value })}
                  className="admin-input"
                />
              </div>
            </label>

            <label className="flex flex-1 flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Cierre
              <div className="flex gap-2">
                <select
                  value={ventana.cierreDia}
                  onChange={(e) => actualizar({ cierreDia: e.target.value as DiaSemanaPedidoB2b })}
                  className="admin-input"
                >
                  {DIAS_SEMANA_PEDIDO_B2B.map((dia) => (
                    <option key={dia.value} value={dia.value}>
                      {dia.label}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  value={ventana.cierreHora}
                  onChange={(e) => actualizar({ cierreHora: e.target.value })}
                  className="admin-input"
                />
              </div>
            </label>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && !error && <p className="text-sm text-admin-green-dark">Guardado.</p>}

        <Button type="submit" disabled={saving} className="self-start">
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </form>
    </Card>
  );
}
