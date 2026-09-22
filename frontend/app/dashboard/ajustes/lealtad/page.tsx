"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchTenantSettings } from "@/lib/api";
import PinSection from "./pin-section";
import VolverAjustesLink from "../volver-link";

// Único campo configurable de esta sección — el API key de WalletWallet y
// la URL de R2 son variables de entorno globales de la plataforma, no algo
// que el tenant configure (ver CLAUDE.md).
export default function ConexionLealtadPage() {
  const { user, token } = useSession();

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {user.rol !== "DUENO" ? (
        <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede editar los ajustes.</p>
      ) : (
        <ConexionLealtadLoader token={token} />
      )}
    </div>
  );
}

function ConexionLealtadLoader({ token }: { token: string }) {
  const [pinConfigurado, setPinConfigurado] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenantSettings(token)
      .then((settings) => setPinConfigurado(settings.pinLealtadConfigurado))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la conexión de Lealtad"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <p className="text-sm text-admin-ink-soft">Cargando...</p>;
  }
  if (loadError) {
    return <p className="text-sm text-red-600">{loadError}</p>;
  }

  return <PinSection token={token} pinConfigurado={pinConfigurado} onGuardado={() => setPinConfigurado(true)} />;
}
