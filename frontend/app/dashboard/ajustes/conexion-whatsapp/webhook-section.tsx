"use client";

import { useState } from "react";
import { ApiError, updateTenantSettings } from "@/lib/api";
import Card from "../../_components/Card";
import Button from "../../_components/Button";

// Sentido OPUESTO a la Llave del bot (ver bot-api-key-section.tsx, arriba
// en esta misma pantalla): esa la genera Aelika y se copia HACIA Botpress.
// Esto lo da Botpress (la URL de su integración Webhook + el secret que
// exige) y Santiago lo copia HACIA acá — por eso son inputs de texto
// editables normales con su propio botón de guardar, sin ningún botón de
// "Regenerar" (Aelika no tiene forma de regenerar un secret que no es
// suyo).
export default function WebhookSection({
  token,
  botWebhookUrl,
  botWebhookSecret,
  onSaved,
}: {
  token: string;
  botWebhookUrl: string | null;
  botWebhookSecret: string | null;
  onSaved: (url: string | null, secret: string | null) => void;
}) {
  const [url, setUrl] = useState(botWebhookUrl ?? "");
  const [secret, setSecret] = useState(botWebhookSecret ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateTenantSettings(token, { botWebhookUrl: url.trim(), botWebhookSecret: secret.trim() });
      onSaved(url.trim() || null, secret.trim() || null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la conexión");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-extrabold text-admin-ink">Webhook de Botpress</h2>
        <p className="text-sm text-admin-ink-soft">
          La URL y el secret de la integración Webhook de tu workflow en Botpress Studio (card &quot;Start
          Conversation&quot;) — Aelika los usa para iniciar conversaciones de WhatsApp desde tus Reglas de
          notificación.
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
        URL del webhook
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://webhook.botpress.cloud/..."
          className="admin-input"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
        Secret del webhook (opcional)
        <input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Se manda en el header x-bp-secret de cada envío"
          className="admin-input"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button variant="secondary" size="sm" onClick={handleSave} disabled={saving} className="self-start">
        {saving ? "Guardando..." : saved ? "Guardado" : "Guardar"}
      </Button>
    </Card>
  );
}
