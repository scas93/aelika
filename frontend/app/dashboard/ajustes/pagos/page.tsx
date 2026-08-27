"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchTenantSettings } from "@/lib/api";
import StripeSection from "../stripe-section";
import VolverAjustesLink from "../volver-link";

export default function AjustesPagosPage() {
  const { user, token } = useSession();

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {user.rol !== "DUENO" ? (
        <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede editar los ajustes.</p>
      ) : (
        <PagosLoader token={token} />
      )}
    </div>
  );
}

function PagosLoader({ token }: { token: string }) {
  const [stripeContactEmail, setStripeContactEmail] = useState<string | null>(null);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [stripeChargesEnabled, setStripeChargesEnabled] = useState(false);
  const [stripePayoutsEnabled, setStripePayoutsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenantSettings(token)
      .then((settings) => {
        setStripeContactEmail(settings.stripeContactEmail);
        setStripeAccountId(settings.stripeAccountId);
        setStripeChargesEnabled(settings.stripeChargesEnabled);
        setStripePayoutsEnabled(settings.stripePayoutsEnabled);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la configuración de Stripe"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <p className="text-sm text-admin-ink-soft">Cargando...</p>;
  }
  if (loadError) {
    return <p className="text-sm text-red-600">{loadError}</p>;
  }

  return (
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
  );
}
