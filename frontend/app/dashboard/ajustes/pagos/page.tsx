"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchTenantSettings, type ModalidadPagoB2b } from "@/lib/api";
import StripeSection from "../stripe-section";
import ModalidadesCobroSection from "../modalidades-cobro-section";
import { mensajeSinAcceso } from "../acceso";
import VolverAjustesLink from "../volver-link";

export default function AjustesPagosPage() {
  const { user, token } = useSession();

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {user.rol !== "DUENO" ? (
        <p className="text-sm text-admin-ink-soft">{mensajeSinAcceso(user.rol)}</p>
      ) : (
        <PagosLoader token={token} esMayoreo={user.tenant.tipoStorefront === "RETAIL_B2B"} />
      )}
    </div>
  );
}

function PagosLoader({ token, esMayoreo }: { token: string; esMayoreo: boolean }) {
  const [modalidades, setModalidades] = useState<ModalidadPagoB2b[]>([]);
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
        setModalidades(settings.modalidadesCobroB2b ?? []);
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

  // Mayoreo: modalidades de cobro; la conexión de Stripe no se muestra (todavía no se usa en mayoreo).
  if (esMayoreo) {
    return <ModalidadesCobroSection token={token} activas={modalidades} onUpdated={setModalidades} />;
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
