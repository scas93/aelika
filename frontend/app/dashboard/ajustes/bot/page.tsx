"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchTenantSettings } from "@/lib/api";
import BotApiKeySection from "../bot-api-key-section";
import VolverAjustesLink from "../volver-link";

export default function AjustesBotPage() {
  const { user, token } = useSession();

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {user.rol !== "DUENO" ? (
        <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede editar los ajustes.</p>
      ) : (
        <BotLoader token={token} />
      )}
    </div>
  );
}

function BotLoader({ token }: { token: string }) {
  const [botApiKey, setBotApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenantSettings(token)
      .then((settings) => setBotApiKey(settings.botApiKey))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la llave del bot"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <p className="text-sm text-admin-ink-soft">Cargando...</p>;
  }
  if (loadError) {
    return <p className="text-sm text-red-600">{loadError}</p>;
  }

  return <BotApiKeySection token={token} botApiKey={botApiKey} onRegenerated={setBotApiKey} />;
}
