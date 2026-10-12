"use client";

import { useEffect, useState } from "react";
import {
  cerrarSesion,
  fetchCalendario,
  type PortalSesion,
} from "@/lib/portal-api";
import BotonWhatsApp from "./boton-whatsapp";
import { BTN_ENLACE, CARD } from "./estilos";

interface Props {
  slug: string;
  sesion: PortalSesion;
  onCrear: () => void;
  onCambiarCliente: () => void;
  onCerrada: () => void;
}

const OPCION =
  "flex w-full flex-col items-start gap-0.5 rounded-xl border border-mayoreo-border bg-mayoreo-card p-4 text-left shadow-sm transition active:opacity-80";
const OPCION_DESHABILITADA = "cursor-not-allowed opacity-50";

// Menú del portal (4d): Crear pedido activo; Modificar y Ver pedidos visibles pero deshabilitados hasta la 4f y la 4e.
export default function MenuPantalla({
  slug,
  sesion,
  onCrear,
  onCambiarCliente,
  onCerrada,
}: Props) {
  const [cerrando, setCerrando] = useState(false);
  const [numeroAtencion, setNumeroAtencion] = useState<string | null>(null);
  const clienteId = sesion.cliente?.id;

  useEffect(() => {
    let activo = true;
    // Solo para el número de atención: si falla, el botón de contacto simplemente no aparece.
    fetchCalendario(slug)
      .then((c) => {
        if (activo) setNumeroAtencion(c.numeroAtencion);
      })
      .catch(() => undefined);
    return () => {
      activo = false;
    };
  }, [slug, clienteId]);

  async function cerrar() {
    setCerrando(true);
    try {
      await cerrarSesion(slug);
    } catch {
      // Aunque falle la red se vuelve al acceso: la cookie la borra el servidor al cerrar o al vencer.
    }
    onCerrada();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-mayoreo-bg p-4 font-mayoreo text-mayoreo-ink">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-mayoreo-ink-soft">{sesion.negocio.nombre}</p>
        <h1 className="text-xl font-bold">Hola, {sesion.cliente?.nombre}</h1>
        <div className="flex gap-4">
          {sesion.clientes.length > 1 && (
            <button className={BTN_ENLACE} onClick={onCambiarCliente}>
              Cambiar de cliente
            </button>
          )}
          <button
            className={BTN_ENLACE}
            disabled={cerrando}
            onClick={() => void cerrar()}
          >
            {cerrando ? "Cerrando…" : "Cerrar sesión"}
          </button>
        </div>
      </header>

      <div className={CARD + " gap-3"}>
        <button className={OPCION} onClick={onCrear}>
          <span className="text-base font-semibold">Crear pedido</span>
          <span className="text-sm text-mayoreo-ink-soft">
            Elige tus días de entrega y tus productos
          </span>
        </button>
        <button
          className={`${OPCION} ${OPCION_DESHABILITADA}`}
          disabled
          aria-disabled="true"
        >
          <span className="text-base font-semibold">
            Modificar pedido activo
          </span>
          <span className="text-sm text-mayoreo-ink-soft">
            Disponible muy pronto
          </span>
        </button>
        <button
          className={`${OPCION} ${OPCION_DESHABILITADA}`}
          disabled
          aria-disabled="true"
        >
          <span className="text-base font-semibold">Ver mis pedidos</span>
          <span className="text-sm text-mayoreo-ink-soft">
            Disponible muy pronto
          </span>
        </button>
      </div>

      <BotonWhatsApp
        numeroAtencion={numeroAtencion}
        contexto={{ tipo: "general", cliente: sesion.cliente?.nombre ?? "" }}
      />
    </main>
  );
}
