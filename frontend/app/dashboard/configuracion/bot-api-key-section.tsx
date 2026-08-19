"use client";

import { useState } from "react";
import { ApiError, regenerateBotApiKey } from "@/lib/api";

const CARD = "rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]";
const BTN_PRIMARY =
  "rounded-lg bg-admin-green px-4 py-2 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40";
const BTN_SECONDARY =
  "rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-bold text-admin-ink/70 transition hover:bg-admin-bg";

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
    <section className={`${CARD} flex flex-col gap-3 p-5`}>
      <div>
        <h2 className="text-sm font-extrabold text-admin-ink">Llave del bot</h2>
        <p className="text-sm text-admin-ink/55">Úsala para conectar el bot de Botpress con la API de Aelika.</p>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg border border-black/10 px-3 py-2.5 font-mono text-sm text-admin-ink">
          {botApiKey}
        </code>
        <button type="button" onClick={handleCopy} className={`${BTN_SECONDARY} shrink-0`}>
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="button" onClick={() => setConfirming(true)} className={`${BTN_SECONDARY} self-start`}>
        Regenerar
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-[14px] bg-white p-6 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
            <h3 className="text-lg font-extrabold text-admin-ink">¿Regenerar la llave del bot?</h3>
            <p className="text-sm text-admin-ink/55">
              La llave actual dejará de funcionar de inmediato. Tendrás que actualizarla también en la configuración
              de Botpress — si no, el bot dejará de poder consultar tu negocio.
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={handleRegenerate} disabled={regenerating} className={BTN_PRIMARY}>
                {regenerating ? "Regenerando..." : "Sí, regenerar"}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={BTN_SECONDARY}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
