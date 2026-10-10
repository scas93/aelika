"use client";

import { useState, useSyncExternalStore } from "react";

// Las llamadas van al MISMO dominio (rewrite /api-portal → API): la cookie es de primera parte.
const BASE = "/api-portal/portal/prueba-sesion";
const LS_KEY = "aelika_prueba_sesion";
const JS_COOKIE = "aelika_prueba_js";

const BTN =
  "rounded-xl bg-black px-4 py-3 text-base font-semibold text-white active:opacity-80 disabled:opacity-50";

type Resultado = {
  accion: string;
  http: number | null;
  cuerpo: unknown;
  hora: string;
};

function almacenamiento() {
  let ls = "no disponible";
  try {
    ls = window.localStorage.getItem(LS_KEY) ?? "(vacío)";
  } catch {
    // acceso bloqueado
  }
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${JS_COOKIE}=`));
  return {
    localStorage: ls,
    cookieJs: match ? match.split("=")[1] : "(vacía)",
  };
}

// Lectura de APIs del navegador sin setState en un efecto: useSyncExternalStore con snapshot de servidor vacío.
const suscriptores = new Set<() => void>();
const suscribir = (cb: () => void) => {
  suscriptores.add(cb);
  return () => {
    suscriptores.delete(cb);
  };
};
const notificar = () => suscriptores.forEach((cb) => cb());
const snapshotAlmacenamiento = () => JSON.stringify(almacenamiento());
const snapshotUa = () => navigator.userAgent;
const snapshotVacio = () => "";

export default function PruebaSesionCliente() {
  const [res, setRes] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const ua = useSyncExternalStore(suscribir, snapshotUa, snapshotVacio);
  const almJson = useSyncExternalStore(
    suscribir,
    snapshotAlmacenamiento,
    snapshotVacio,
  );
  const alm = almJson
    ? (JSON.parse(almJson) as { localStorage: string; cookieJs: string })
    : null;

  async function llamar(accion: "iniciar" | "estado" | "cerrar") {
    setCargando(true);
    const hora = new Date().toLocaleString("es-MX");
    try {
      const r = await fetch(`${BASE}/${accion}`, {
        method: accion === "estado" ? "GET" : "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
      const cuerpo: unknown = await r.json().catch(() => null);
      setRes({ accion, http: r.status, cuerpo, hora });
      // Misma marca en localStorage y en una cookie escrita por JS, para comparar qué almacenamiento sobrevive.
      try {
        if (accion === "iniciar") {
          const marca = new Date().toISOString();
          window.localStorage.setItem(LS_KEY, marca);
          document.cookie = `${JS_COOKIE}=${marca}; Max-Age=${90 * 24 * 3600}; Path=/; Secure; SameSite=Lax`;
        } else if (accion === "cerrar") {
          window.localStorage.removeItem(LS_KEY);
          document.cookie = `${JS_COOKIE}=; Max-Age=0; Path=/; Secure; SameSite=Lax`;
        }
      } catch {
        // acceso bloqueado
      }
    } catch (e) {
      setRes({ accion, http: null, cuerpo: String(e), hora });
    } finally {
      notificar();
      setCargando(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-white p-4 text-black">
      <h1 className="text-xl font-bold">Prueba de sesión (staging)</h1>
      <p className="text-sm text-gray-600">
        Toca <b>Iniciar</b>, cierra este navegador y vuelve a abrir el enlace;
        luego toca <b>Ver estado</b>. Si la sesión sobrevive verás la misma
        fecha de creación.
      </p>

      <div className="flex flex-col gap-2">
        <button
          className={BTN}
          disabled={cargando}
          onClick={() => llamar("iniciar")}
        >
          Iniciar
        </button>
        <button
          className={BTN}
          disabled={cargando}
          onClick={() => llamar("estado")}
        >
          Ver estado
        </button>
        <button
          className={BTN}
          disabled={cargando}
          onClick={() => llamar("cerrar")}
        >
          Cerrar
        </button>
      </div>

      <section className="rounded-xl border border-gray-300 p-3 text-sm">
        <h2 className="mb-1 font-semibold">Resultado</h2>
        {res ? (
          <pre className="whitespace-pre-wrap break-words text-xs">
            {`${res.hora}\n${res.accion} → HTTP ${res.http ?? "error"}\n${JSON.stringify(res.cuerpo, null, 2)}`}
          </pre>
        ) : (
          <p className="text-gray-500">Sin llamadas todavía.</p>
        )}
      </section>

      <section className="rounded-xl border border-gray-300 p-3 text-sm">
        <h2 className="mb-1 font-semibold">
          Almacenamiento del navegador (comparación)
        </h2>
        <p className="break-words text-xs">
          localStorage: {alm?.localStorage ?? "…"}
        </p>
        <p className="break-words text-xs">
          Cookie escrita por JS: {alm?.cookieJs ?? "…"}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          La cookie del servidor es HttpOnly: no se ve aquí, se comprueba con
          «Ver estado».
        </p>
      </section>

      <section className="rounded-xl border border-gray-300 p-3 text-sm">
        <h2 className="mb-1 font-semibold">User agent</h2>
        <p className="break-words text-xs">{ua || "…"}</p>
      </section>
    </main>
  );
}
