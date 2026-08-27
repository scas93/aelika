"use client";

import { useEffect, useState } from "react";
import { ApiError, fetchTenantSettings, horarioSemanaVacio, updateTenantSettings, type HorarioSemana } from "@/lib/api";
import HorarioEditor from "@/components/horario-editor";
import Card from "../_components/Card";
import Button from "../_components/Button";

// A diferencia de las demás secciones (que reciben su slice de TenantSettings
// como prop desde un padre), esta es autocontenida — mismo patrón que
// PuntosEnvioSection: hace su propio fetchTenantSettings, sin depender de un
// estado compartido con otras subrutas de /dashboard/ajustes.
export default function NegocioSection({ token }: { token: string }) {
  const [mensajeBienvenida, setMensajeBienvenida] = useState("");
  const [horario, setHorario] = useState<HorarioSemana>(() => horarioSemanaVacio());
  const [ubicacion, setUbicacion] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const settings = await fetchTenantSettings(token);
        setMensajeBienvenida(settings.mensajeBienvenida);
        setHorario(settings.horarioAtencion ?? horarioSemanaVacio());
        setUbicacion(settings.ubicacion ?? "");
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la información del negocio");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const settings = await updateTenantSettings(token, {
        mensajeBienvenida,
        horarioAtencion: horario,
        ubicacion: ubicacion || undefined,
      });
      setMensajeBienvenida(settings.mensajeBienvenida);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la información del negocio");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-admin-ink-soft">Cargando...</p>;
  }

  if (loadError) {
    return <p className="text-sm text-red-600">{loadError}</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Card>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Mensaje de bienvenida
          <textarea
            value={mensajeBienvenida}
            onChange={(e) => {
              setMensajeBienvenida(e.target.value);
              setSaved(false);
            }}
            rows={3}
            placeholder="¡Hola! ¿En qué te podemos ayudar?"
            className="admin-input min-h-[80px] resize-none"
          />
        </label>
      </Card>

      <Card className="flex flex-col gap-5">
        <HorarioEditor
          horario={horario}
          onChange={(value) => {
            setHorario(value);
            setSaved(false);
          }}
        />

        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Ubicación
          <input
            value={ubicacion}
            onChange={(e) => {
              setUbicacion(e.target.value);
              setSaved(false);
            }}
            placeholder="Av. Siempre Viva 123"
            className="admin-input"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && !error && <p className="text-sm text-admin-green-dark">Guardado.</p>}

        <Button type="submit" disabled={saving} className="self-start">
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </Card>
    </form>
  );
}
