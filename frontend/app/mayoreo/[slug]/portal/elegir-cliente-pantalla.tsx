"use client";

import { useState } from "react";
import { capturar } from "@/lib/analitica";
import {
  PortalError,
  elegirCliente,
  type PortalSesion,
} from "@/lib/portal-api";
import { ERROR, OPCION, WRAPPER } from "./estilos";

interface Props {
  slug: string;
  sesion: PortalSesion;
  onElegido: () => void;
  onSesionTerminada: () => void;
}

// Un mismo teléfono puede estar autorizado en varios clientes del negocio (ej. varias sucursales): se elige con cuál entrar.
export default function ElegirClientePantalla({
  slug,
  sesion,
  onElegido,
  onSesionTerminada,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState<string | null>(null);

  async function elegir(id: string) {
    setError(null);
    setEligiendo(id);
    try {
      await elegirCliente(slug, id);
      capturar("cliente_elegido", { slug });
      onElegido();
    } catch (e) {
      if (e instanceof PortalError && e.status === 401)
        return onSesionTerminada();
      setError(
        e instanceof PortalError
          ? e.message
          : "Algo salió mal. Intenta de nuevo",
      );
      setEligiendo(null);
    }
  }

  return (
    <main className={WRAPPER}>
      <header className="flex flex-col gap-1">
        <p className="text-sm text-mayoreo-ink-soft">{sesion.negocio.nombre}</p>
        <h1 className="text-xl font-bold">¿Con cuál cliente quieres entrar?</h1>
      </header>
      {error && <p className={ERROR}>{error}</p>}
      <div className="flex flex-col gap-3">
        {sesion.clientes.map((c) => (
          <button
            key={c.id}
            className={OPCION}
            disabled={eligiendo !== null}
            onClick={() => void elegir(c.id)}
          >
            <span className="text-base font-semibold">{c.nombre}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
