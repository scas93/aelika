"use client";

import { useState } from "react";
import { ApiError, setLealtadPin } from "@/lib/api";
import Card from "../../_components/Card";
import Button from "../../_components/Button";

export default function PinSection({
  token,
  pinConfigurado,
  onGuardado,
}: {
  token: string;
  pinConfigurado: boolean;
  onGuardado: () => void;
}) {
  const [pin, setPin] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      await setLealtadPin(token, pin);
      setPin("");
      setGuardado(true);
      onGuardado();
      setTimeout(() => setGuardado(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el PIN");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-extrabold text-admin-ink">PIN de Lealtad</h2>
        <p className="text-sm text-admin-ink-soft">
          Protege la pantalla de &quot;Registrar nueva compra&quot; del Programa de Lealtad — es un candado
          operativo, único para todo el negocio (no distingue entre cajeras).
        </p>
        <p className="mt-1 text-xs font-semibold text-admin-ink-soft">
          {pinConfigurado ? "Ya hay un PIN configurado." : "Todavía no has configurado un PIN."}
        </p>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
        {pinConfigurado ? "Nuevo PIN" : "PIN"}
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          inputMode="numeric"
          pattern="\d{4,6}"
          minLength={4}
          maxLength={6}
          className="admin-input max-w-[160px]"
          placeholder="4-6 dígitos"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button
        variant="secondary"
        size="sm"
        onClick={handleGuardar}
        disabled={guardando || !/^\d{4,6}$/.test(pin)}
        className="self-start"
      >
        {guardando ? "Guardando..." : guardado ? "Guardado" : pinConfigurado ? "Cambiar PIN" : "Guardar PIN"}
      </Button>
    </Card>
  );
}
