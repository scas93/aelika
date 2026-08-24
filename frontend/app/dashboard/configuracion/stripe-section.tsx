"use client";

import { useState } from "react";
import { ApiError, createTenantStripeAccount, fetchTenantStripeStatus, updateTenantSettings } from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";

// Basic shape check only ("algo@algo.algo") — the backend (@IsEmail, class-validator)
// is the real source of truth, this is just to catch obvious typos before a
// round trip to the server.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function StripeSection({
  token,
  stripeContactEmail,
  onStripeContactEmailUpdated,
  stripeAccountId,
  stripeChargesEnabled,
  stripePayoutsEnabled,
  onUpdated,
}: {
  token: string;
  stripeContactEmail: string | null;
  onStripeContactEmailUpdated: (correo: string | null) => void;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  onUpdated: (fields: {
    stripeAccountId: string | null;
    stripeChargesEnabled: boolean;
    stripePayoutsEnabled: boolean;
  }) => void;
}) {
  const [correo, setCorreo] = useState(stripeContactEmail ?? "");
  const [savingCorreo, setSavingCorreo] = useState(false);
  const [correoSaved, setCorreoSaved] = useState(false);
  const [correoError, setCorreoError] = useState<string | null>(null);

  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conectado = Boolean(stripeAccountId) && stripeChargesEnabled && stripePayoutsEnabled;
  const verificacionPendiente = Boolean(stripeAccountId) && !conectado;

  async function handleGuardarCorreo(e: React.FormEvent) {
    e.preventDefault();
    setCorreoError(null);
    setCorreoSaved(false);

    const correoTrimmed = correo.trim();
    if (correoTrimmed !== "" && !EMAIL_PATTERN.test(correoTrimmed)) {
      setCorreoError("El correo no tiene un formato válido");
      return;
    }

    setSavingCorreo(true);
    try {
      const settings = await updateTenantSettings(token, { stripeContactEmail: correoTrimmed || undefined });
      onStripeContactEmailUpdated(settings.stripeContactEmail);
      setCorreoSaved(true);
    } catch (err) {
      setCorreoError(err instanceof ApiError ? err.message : "No se pudo guardar el correo");
    } finally {
      setSavingCorreo(false);
    }
  }

  // Handles both "conectar por primera vez" y "continuar verificación" — el
  // backend ya sabe distinguir ambos casos (crea cuenta si no existe, o
  // genera un link nuevo para la que ya existe), así que aquí es el mismo
  // request y el mismo botón en espíritu, solo cambia la etiqueta.
  async function handleConectar() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await createTenantStripeAccount(token);
      window.open(url, "_blank");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar la conexión con Stripe");
    } finally {
      setConnecting(false);
    }
  }

  async function handleActualizarEstado() {
    setRefreshing(true);
    setError(null);
    try {
      const status = await fetchTenantStripeStatus(token);
      if (status.estado === "sin_cuenta") {
        onUpdated({ stripeAccountId: null, stripeChargesEnabled: false, stripePayoutsEnabled: false });
      } else {
        onUpdated({
          stripeAccountId: status.stripeAccountId ?? null,
          stripeChargesEnabled: Boolean(status.chargesEnabled),
          stripePayoutsEnabled: Boolean(status.payoutsEnabled),
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo consultar el estado de Stripe");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-extrabold text-admin-ink">Cobros con tarjeta (Stripe)</h2>
        <p className="text-sm text-admin-ink-soft">
          Conecta tu cuenta de Stripe para poder recibir pagos con tarjeta en tu catálogo web.
        </p>
      </div>

      <form onSubmit={handleGuardarCorreo} className="flex flex-col gap-1.5">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Correo de contacto para Stripe
          <input
            type="email"
            value={correo}
            onChange={(e) => {
              setCorreo(e.target.value);
              setCorreoSaved(false);
            }}
            placeholder="contacto@tunegocio.com"
            className="admin-input"
          />
          <span className="text-xs font-normal text-admin-ink-soft">
            El correo donde Stripe manda avisos de verificación y pagos de este negocio — no necesariamente el
            correo público del negocio.
          </span>
        </label>

        {correoError && <p className="text-sm text-red-600">{correoError}</p>}
        {correoSaved && !correoError && <p className="text-sm text-admin-green-dark">Guardado.</p>}

        <Button type="submit" variant="secondary" size="sm" disabled={savingCorreo} className="mt-1 self-start">
          {savingCorreo ? "Guardando..." : "Guardar correo"}
        </Button>
      </form>

      {conectado && (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-admin-green/10 px-3 py-1 text-xs font-bold text-admin-green-dark">
          Conectado ✅
        </span>
      )}

      {verificacionPendiente && (
        <p className="text-sm font-medium text-admin-ink-soft">
          Verificación pendiente — termina de completar los datos que Stripe te pidió para poder empezar a cobrar.
        </p>
      )}

      {!stripeContactEmail && (
        <p className="text-sm text-admin-ink-soft">Guarda tu correo de contacto para poder conectar con Stripe.</p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!conectado && (
        <Button
          type="button"
          onClick={handleConectar}
          disabled={connecting || !stripeContactEmail}
          className="self-start"
        >
          {connecting ? "Redirigiendo..." : verificacionPendiente ? "Continuar verificación" : "Conectar con Stripe"}
        </Button>
      )}

      {(conectado || verificacionPendiente) && (
        <Button type="button" variant="secondary" onClick={handleActualizarEstado} disabled={refreshing} className="self-start">
          {refreshing ? "Consultando..." : "Actualizar estado"}
        </Button>
      )}
    </Card>
  );
}
