"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  fetchTenantSettings,
  horarioSemanaVacio,
  updateTenantSettings,
  type FacturacionModo,
  type HorarioSemana,
} from "@/lib/api";
import HorarioEditor from "@/components/horario-editor";
import BotApiKeySection from "./bot-api-key-section";
import FacturacionSection from "./facturacion-section";
import PuntosEnvioSection from "./puntos-envio-section";
import StripeSection from "./stripe-section";

const CARD = "rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]";
const BTN_PRIMARY =
  "self-start rounded-lg bg-admin-green px-5 py-2.5 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40";

export default function ConfiguracionPage() {
  const { user, token } = useSession();

  if (user.rol !== "DUENO") {
    return <p className="text-sm text-admin-ink/55">Solo el dueño del negocio puede editar la configuración.</p>;
  }

  return <ConfiguracionForm token={token} />;
}

function ConfiguracionForm({ token }: { token: string }) {
  const [mensajeBienvenida, setMensajeBienvenida] = useState("");
  const [horario, setHorario] = useState<HorarioSemana>(() => horarioSemanaVacio());
  const [ubicacion, setUbicacion] = useState("");
  const [botApiKey, setBotApiKey] = useState("");
  const [facturacionModo, setFacturacionModo] = useState<FacturacionModo>("DESACTIVADO");
  const [stripeContactEmail, setStripeContactEmail] = useState<string | null>(null);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [stripeChargesEnabled, setStripeChargesEnabled] = useState(false);
  const [stripePayoutsEnabled, setStripePayoutsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const settings = await fetchTenantSettings(token);
        setMensajeBienvenida(settings.mensajeBienvenida);
        setHorario(settings.horarioAtencion ?? horarioSemanaVacio());
        setUbicacion(settings.ubicacion ?? "");
        setBotApiKey(settings.botApiKey);
        setFacturacionModo(settings.facturacionModo);
        setStripeContactEmail(settings.stripeContactEmail);
        setStripeAccountId(settings.stripeAccountId);
        setStripeChargesEnabled(settings.stripeChargesEnabled);
        setStripePayoutsEnabled(settings.stripePayoutsEnabled);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo cargar la configuración");
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
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la configuración");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-admin-ink/55">Cargando...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className={`${CARD} flex flex-col gap-5 p-5`}>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Mensaje de bienvenida
          <textarea
            value={mensajeBienvenida}
            onChange={(e) => {
              setMensajeBienvenida(e.target.value);
              setSaved(false);
            }}
            rows={3}
            placeholder="¡Hola! ¿En qué te podemos ayudar?"
            className="input resize-none"
          />
        </label>

        <HorarioEditor
          horario={horario}
          onChange={(value) => {
            setHorario(value);
            setSaved(false);
          }}
        />

        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Ubicación
          <input
            value={ubicacion}
            onChange={(e) => {
              setUbicacion(e.target.value);
              setSaved(false);
            }}
            placeholder="Av. Siempre Viva 123"
            className="input"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && !error && <p className="text-sm text-admin-green-dark">Guardado.</p>}

        <button type="submit" disabled={saving} className={BTN_PRIMARY}>
          {saving ? "Guardando..." : "Guardar"}
        </button>
      </form>

      <FacturacionSection token={token} facturacionModo={facturacionModo} onUpdated={setFacturacionModo} />

      <PuntosEnvioSection token={token} />

      <StripeSection
        token={token}
        stripeContactEmail={stripeContactEmail}
        onStripeContactEmailUpdated={setStripeContactEmail}
        stripeAccountId={stripeAccountId}
        stripeChargesEnabled={stripeChargesEnabled}
        stripePayoutsEnabled={stripePayoutsEnabled}
        onUpdated={(fields) => {
          setStripeAccountId(fields.stripeAccountId);
          setStripeChargesEnabled(fields.stripeChargesEnabled);
          setStripePayoutsEnabled(fields.stripePayoutsEnabled);
        }}
      />

      <BotApiKeySection token={token} botApiKey={botApiKey} onRegenerated={setBotApiKey} />
    </div>
  );
}
