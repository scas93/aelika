"use client";

import { useState } from "react";
import { ApiError, regenerateBotApiKey } from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";
import Modal from "../_components/Modal";

export default function BotApiKeySection({
  token,
  botApiKey,
  onRegenerated,
}: {
  token: string;
  botApiKey: string;
  onRegenerated: (newKey: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCopy() {
    await navigator.clipboard.writeText(botApiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      const updated = await regenerateBotApiKey(token);
      onRegenerated(updated.botApiKey);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo regenerar la llave");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-extrabold text-admin-ink">Llave del bot</h2>
        <p className="text-sm text-admin-ink-soft">Úsala para conectar el bot de Botpress con la API de Aelika.</p>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-[var(--radius-admin-control)] border border-admin-border px-3 py-2.5 font-mono text-sm text-admin-ink">
          {botApiKey}
        </code>
        <Button variant="secondary" size="sm" onClick={handleCopy} className="shrink-0">
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button variant="secondary" size="sm" onClick={() => setConfirming(true)} className="self-start">
        Regenerar
      </Button>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="¿Regenerar la llave del bot?"
        footer={
          <>
            <Button variant="primary" onClick={handleRegenerate} disabled={regenerating}>
              {regenerating ? "Regenerando..." : "Sí, regenerar"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
          </>
        }
      >
        <p className="text-sm text-admin-ink-soft">
          La llave actual dejará de funcionar de inmediato. Tendrás que actualizarla también en la configuración
          de Botpress — si no, el bot dejará de poder consultar tu negocio.
        </p>
      </Modal>
    </Card>
  );
}
