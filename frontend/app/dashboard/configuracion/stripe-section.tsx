"use client";

import { useState } from "react";
import { ApiError, createTenantStripeAccount, fetchTenantStripeStatus } from "@/lib/api";

const CARD = "rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]";
const BTN_PRIMARY =
  "self-start rounded-lg bg-admin-green px-4 py-2 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40";
const BTN_SECONDARY =
  "self-start rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-bold text-admin-ink/70 transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40";

export default function StripeSection({
  token,
  stripeAccountId,
  stripeChargesEnabled,
  stripePayoutsEnabled,
  onUpdated,
}: {
  token: string;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  onUpdated: (fields: {
    stripeAccountId: string | null;
    stripeChargesEnabled: boolean;
    stripePayoutsEnabled: boolean;
  }) => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conectado = Boolean(stripeAccountId) && stripeChargesEnabled && stripePayoutsEnabled;
  const verificacionPendiente = Boolean(stripeAccountId) && !conectado;

  // Handles both "conectar por primera vez" y "continuar verificación" — el
  // backend ya sabe distinguir ambos casos (crea cuenta si no existe, o
  // genera un link nuevo para la que ya existe), así que aquí es el mismo
  // request y el mismo botón en espíritu, solo cambia la etiqueta.
  async function handleConectar() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await createTenantStripeAccount(token);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar la conexión con Stripe");
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
    <section className={`${CARD} flex flex-col gap-3 p-5`}>
      <div>
        <h2 className="text-sm font-extrabold text-admin-ink">Cobros con tarjeta (Stripe)</h2>
        <p className="text-sm text-admin-ink/55">
          Conecta tu cuenta de Stripe para poder recibir pagos con tarjeta en tu catálogo web.
        </p>
      </div>

      {conectado && (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-admin-green/10 px-3 py-1 text-xs font-bold text-admin-green-dark">
          Conectado ✅
        </span>
      )}

      {verificacionPendiente && (
        <p className="text-sm font-medium text-admin-ink/70">
          Verificación pendiente — termina de completar los datos que Stripe te pidió para poder empezar a cobrar.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!conectado && (
        <button type="button" onClick={handleConectar} disabled={connecting} className={BTN_PRIMARY}>
          {connecting ? "Redirigiendo..." : verificacionPendiente ? "Continuar verificación" : "Conectar con Stripe"}
        </button>
      )}

      {conectado && (
        <button type="button" onClick={handleActualizarEstado} disabled={refreshing} className={BTN_SECONDARY}>
          {refreshing ? "Consultando..." : "Actualizar estado"}
        </button>
      )}
    </section>
  );
}
