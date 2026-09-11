"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchTenantSettings } from "@/lib/api";
import BotApiKeySection from "./bot-api-key-section";
import WebhookSection from "./webhook-section";
import CandadoSection from "./candado-section";
import VolverAjustesLink from "../volver-link";

// Reemplaza /dashboard/ajustes/bot ("Llave del bot") — ahora junta las 3
// cosas relacionadas con la conexión a Botpress/WhatsApp: la llave que
// genera Aelika (botApiKey), el webhook que da Botpress (botWebhookUrl/
// Secret), y el candado de frecuencia de Recontacto. Cada sección guarda
// por su cuenta (mismo patrón que el resto de Ajustes), así que el estado
// se levanta aquí una sola vez y se actualiza localmente tras cada guardado
// exitoso, sin tener que recargar todo /tenant/me.
export default function ConexionWhatsAppPage() {
  const { user, token } = useSession();

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {user.rol !== "DUENO" ? (
        <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede editar los ajustes.</p>
      ) : (
        <ConexionWhatsAppLoader token={token} />
      )}
    </div>
  );
}

function ConexionWhatsAppLoader({ token }: { token: string }) {
  const [botApiKey, setBotApiKey] = useState("");
  const [botWebhookUrl, setBotWebhookUrl] = useState<string | null>(null);
  const [botWebhookSecret, setBotWebhookSecret] = useState<string | null>(null);
  const [candadoMarketingDias, setCandadoMarketingDias] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenantSettings(token)
      .then((settings) => {
        setBotApiKey(settings.botApiKey);
        setBotWebhookUrl(settings.botWebhookUrl);
        setBotWebhookSecret(settings.botWebhookSecret);
        setCandadoMarketingDias(settings.candadoMarketingDias);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la conexión con WhatsApp"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <p className="text-sm text-admin-ink-soft">Cargando...</p>;
  }
  if (loadError) {
    return <p className="text-sm text-red-600">{loadError}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <BotApiKeySection token={token} botApiKey={botApiKey} onRegenerated={setBotApiKey} />
      <WebhookSection
        token={token}
        botWebhookUrl={botWebhookUrl}
        botWebhookSecret={botWebhookSecret}
        onSaved={(url, secret) => {
          setBotWebhookUrl(url);
          setBotWebhookSecret(secret);
        }}
      />
      <CandadoSection token={token} candadoMarketingDias={candadoMarketingDias} onSaved={setCandadoMarketingDias} />
    </div>
  );
}
