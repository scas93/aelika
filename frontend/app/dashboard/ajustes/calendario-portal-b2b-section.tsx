"use client";

import { useState } from "react";
import { ApiError, updateTenantSettings, type TenantSettings } from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";

export interface CalendarioPortalB2b {
  portalHoraEntrega: string;
  portalHorasAgregarDia: number;
  portalHorasModificar: number;
  portalHorizonteSemanas: number;
  numeroAtencion: string | null;
}

export const calendarioDesdeSettings = (
  s: TenantSettings,
): CalendarioPortalB2b => ({
  portalHoraEntrega: s.portalHoraEntrega,
  portalHorasAgregarDia: s.portalHorasAgregarDia,
  portalHorasModificar: s.portalHorasModificar,
  portalHorizonteSemanas: s.portalHorizonteSemanas,
  numeroAtencion: s.numeroAtencion,
});

const entero = (v: string, min: number, max: number) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) && n >= min && n <= max
    ? n
    : null;
};

/**
 * Calendario del portal del cliente de mayoreo (Admin): hora de entrega, anticipación para pedir y para modificar, cuántas
 * semanas se pueden pedir y número de atención. Todo en hora de Ciudad de México.
 */
export default function CalendarioPortalB2bSection({
  token,
  calendario,
  onUpdated,
}: {
  token: string;
  calendario: CalendarioPortalB2b;
  onUpdated: (c: CalendarioPortalB2b) => void;
}) {
  const [hora, setHora] = useState(calendario.portalHoraEntrega);
  const [agregar, setAgregar] = useState(
    String(calendario.portalHorasAgregarDia),
  );
  const [modificar, setModificar] = useState(
    String(calendario.portalHorasModificar),
  );
  const [horizonte, setHorizonte] = useState(
    String(calendario.portalHorizonteSemanas),
  );
  const [numero, setNumero] = useState(calendario.numeroAtencion ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const horaValida = /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);
  const agregarN = entero(agregar, 0, 168);
  const modificarN = entero(modificar, 0, 168);
  const horizonteN = entero(horizonte, 0, 4);
  const digitos = numero.replace(/\D/g, "");
  const nacional =
    digitos.length > 10 && digitos.startsWith("52")
      ? digitos.slice(2)
      : digitos;
  const numeroValido = digitos.length === 0 || nacional.length === 10;
  const valido =
    horaValida &&
    agregarN !== null &&
    modificarN !== null &&
    horizonteN !== null &&
    numeroValido;

  function tocar() {
    setSaved(false);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !valido ||
      agregarN === null ||
      modificarN === null ||
      horizonteN === null
    )
      return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const settings = await updateTenantSettings(token, {
        portalHoraEntrega: hora,
        portalHorasAgregarDia: agregarN,
        portalHorasModificar: modificarN,
        portalHorizonteSemanas: horizonteN,
        numeroAtencion: digitos.length === 0 ? null : numero,
      });
      const nuevo = calendarioDesdeSettings(settings);
      onUpdated(nuevo);
      setNumero(nuevo.numeroAtencion ?? "");
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "No se pudo guardar el calendario del portal",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-admin-ink">
            Calendario del portal del cliente
          </h2>
          <p className="text-sm text-admin-ink-soft">
            Define qué días puede pedir, agregar o modificar un cliente desde su
            portal. Todo en hora de Ciudad de México. Los cambios aplican de
            inmediato a lo que ve el cliente; no modifican pedidos ya creados.
          </p>
        </div>

        <label className="flex max-w-[220px] flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Hora de entrega
          <input
            type="time"
            value={hora}
            onChange={(e) => {
              setHora(e.target.value);
              tocar();
            }}
            className="admin-input"
          />
          <span className="text-xs font-normal text-admin-ink-soft">
            La misma para todas las entregas del negocio.
          </span>
        </label>
        {!horaValida && (
          <p className="text-sm text-red-600">Escribe una hora válida.</p>
        )}

        <label className="flex max-w-[220px] flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Horas de anticipación para pedir o agregar un día
          <input
            type="number"
            min="0"
            max="168"
            step="1"
            inputMode="numeric"
            value={agregar}
            onChange={(e) => {
              setAgregar(e.target.value);
              tocar();
            }}
            className="admin-input"
          />
          <span className="text-xs font-normal text-admin-ink-soft">
            Una entrega solo se puede pedir si faltan al menos estas horas. Ej.
            36.
          </span>
        </label>
        {agregarN === null && (
          <p className="text-sm text-red-600">Escribe un entero de 0 a 168.</p>
        )}

        <label className="flex max-w-[220px] flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Horas de anticipación para modificar o quitar
          <input
            type="number"
            min="0"
            max="168"
            step="1"
            inputMode="numeric"
            value={modificar}
            onChange={(e) => {
              setModificar(e.target.value);
              tocar();
            }}
            className="admin-input"
          />
          <span className="text-xs font-normal text-admin-ink-soft">
            Cambiar o quitar una entrega ya pedida exige al menos estas horas.
            Ej. 18.
          </span>
        </label>
        {modificarN === null && (
          <p className="text-sm text-red-600">Escribe un entero de 0 a 168.</p>
        )}

        <label className="flex max-w-[220px] flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Semanas que se pueden pedir
          <input
            type="number"
            min="0"
            max="4"
            step="1"
            inputMode="numeric"
            value={horizonte}
            onChange={(e) => {
              setHorizonte(e.target.value);
              tocar();
            }}
            className="admin-input"
          />
          <span className="text-xs font-normal text-admin-ink-soft">
            Además de la semana en curso. 0 = solo la semana en curso; 1 = en
            curso y la siguiente.
          </span>
        </label>
        {horizonteN === null && (
          <p className="text-sm text-red-600">Escribe un entero de 0 a 4.</p>
        )}

        <label className="flex max-w-[260px] flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Número de atención (opcional)
          <input
            type="tel"
            inputMode="tel"
            placeholder="10 dígitos"
            value={numero}
            onChange={(e) => {
              setNumero(e.target.value);
              tocar();
            }}
            className="admin-input"
          />
          <span className="text-xs font-normal text-admin-ink-soft">
            WhatsApp al que el cliente escribe desde el botón «Contactar al
            negocio». Vacío = el botón no aparece.
          </span>
        </label>
        {!numeroValido && (
          <p className="text-sm text-red-600">
            El número debe tener 10 dígitos.
          </p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && !error && (
          <p className="text-sm text-admin-green-dark">Guardado.</p>
        )}

        <Button
          type="submit"
          disabled={saving || !valido}
          className="self-start"
        >
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </form>
    </Card>
  );
}
