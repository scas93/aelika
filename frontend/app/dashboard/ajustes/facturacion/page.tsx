"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchTenantSettings, type FacturacionModo } from "@/lib/api";
import FacturacionSection from "../facturacion-section";
import VolverAjustesLink from "../volver-link";

// FacturacionSection espera facturacionModo+onUpdated como props (no
// reescribimos su lógica interna) — antes venían del fetch compartido de
// ConfiguracionForm, ahora esta página hace su propio fetchTenantSettings,
// mismo patrón ya aceptado para las subrutas de /dashboard/ajustes.
export default function AjustesFacturacionPage() {
  const { user, token } = useSession();

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {user.rol !== "DUENO" ? (
        <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede editar los ajustes.</p>
      ) : (
        <FacturacionLoader token={token} />
      )}
    </div>
  );
}

function FacturacionLoader({ token }: { token: string }) {
  const [facturacionModo, setFacturacionModo] = useState<FacturacionModo>("DESACTIVADO");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenantSettings(token)
      .then((settings) => setFacturacionModo(settings.facturacionModo))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la facturación"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <p className="text-sm text-admin-ink-soft">Cargando...</p>;
  }
  if (loadError) {
    return <p className="text-sm text-red-600">{loadError}</p>;
  }

  return <FacturacionSection token={token} facturacionModo={facturacionModo} onUpdated={setFacturacionModo} />;
}
