"use client";

import { useEffect, useState } from "react";
import { PortalError, pedirCodigo, verificarCodigo } from "@/lib/portal-api";
import { BTN_ENLACE, BTN_PRIMARIO, CARD, ERROR } from "./estilos";

const ESPERA_REENVIO_S = 30;
const clave = (slug: string) => `aelika_portal_tel_${slug}`;

// El teléfono queda guardado en el dispositivo (solo para precargarlo; no es una credencial).
function telefonoGuardado(slug: string): string {
  try {
    return window.localStorage.getItem(clave(slug)) ?? "";
  } catch {
    return "";
  }
}
function guardarTelefono(slug: string, tel: string) {
  try {
    window.localStorage.setItem(clave(slug), tel);
  } catch {
    // almacenamiento bloqueado: se ignora
  }
}

interface Props {
  slug: string;
  negocio: string;
  /** Mensaje cuando una sesión previa terminó (cliente dado de baja, teléfono quitado…). */
  aviso?: string | null;
  onEntro: () => void;
}

export default function AccesoPantalla({
  slug,
  negocio,
  aviso,
  onEntro,
}: Props) {
  const [paso, setPaso] = useState<"telefono" | "codigo">("telefono");
  const [telefono, setTelefono] = useState(() =>
    typeof window === "undefined" ? "" : telefonoGuardado(slug),
  );
  const [codigo, setCodigo] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [espera, setEspera] = useState(0);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((e) => e - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const telefonoValido = telefono.replace(/\D/g, "").length >= 10;

  async function enviar() {
    setError(null);
    setCargando(true);
    try {
      const r = await pedirCodigo(slug, telefono);
      guardarTelefono(slug, telefono);
      setMensaje(r.mensaje);
      setCodigo("");
      setPaso("codigo");
      setEspera(ESPERA_REENVIO_S);
    } catch (e) {
      setError(
        e instanceof PortalError
          ? e.message
          : "Algo salió mal. Intenta de nuevo",
      );
    } finally {
      setCargando(false);
    }
  }

  async function entrar() {
    setError(null);
    setCargando(true);
    try {
      await verificarCodigo(slug, telefono, codigo);
      onEntro();
    } catch (e) {
      setError(
        e instanceof PortalError
          ? e.message
          : "Algo salió mal. Intenta de nuevo",
      );
      setCargando(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 bg-mayoreo-bg p-4 font-mayoreo text-mayoreo-ink">
      <div className={CARD}>
        <div>
          <p className="text-sm text-mayoreo-ink-soft">{negocio}</p>
          <h1 className="text-xl font-bold">Entra a tu cuenta</h1>
        </div>

        {aviso && <p className={ERROR}>{aviso}</p>}

        {paso === "telefono" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (telefonoValido && !cargando) void enviar();
            }}
          >
            <label
              className="flex flex-col gap-1 text-sm font-medium"
              htmlFor="telefono"
            >
              Tu teléfono
              <input
                id="telefono"
                className="mayoreo-input text-base"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="10 dígitos"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
              />
            </label>
            <p className="text-xs text-mayoreo-ink-soft">
              Te enviaremos un código por WhatsApp al teléfono autorizado de tu
              negocio.
            </p>
            {error && <p className={ERROR}>{error}</p>}
            <button
              type="submit"
              className={BTN_PRIMARIO}
              disabled={!telefonoValido || cargando}
            >
              {cargando ? "Enviando…" : "Enviar código"}
            </button>
          </form>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (codigo.length === 6 && !cargando) void entrar();
            }}
          >
            {mensaje && (
              <p className="text-sm text-mayoreo-ink-soft">{mensaje}</p>
            )}
            <label
              className="flex flex-col gap-1 text-sm font-medium"
              htmlFor="codigo"
            >
              Código de 6 dígitos
              <input
                id="codigo"
                className="mayoreo-input text-center text-2xl tracking-[0.4em]"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="••••••"
                value={codigo}
                onChange={(e) =>
                  setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
            </label>
            {error && <p className={ERROR}>{error}</p>}
            <button
              type="submit"
              className={BTN_PRIMARIO}
              disabled={codigo.length !== 6 || cargando}
            >
              {cargando ? "Entrando…" : "Entrar"}
            </button>
            <div className="flex items-center justify-between">
              <button
                type="button"
                className={BTN_ENLACE}
                disabled={espera > 0 || cargando}
                onClick={() => void enviar()}
              >
                {espera > 0
                  ? `Reenviar código (${espera} s)`
                  : "Reenviar código"}
              </button>
              <button
                type="button"
                className={BTN_ENLACE}
                onClick={() => {
                  setPaso("telefono");
                  setError(null);
                }}
              >
                Cambiar teléfono
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
