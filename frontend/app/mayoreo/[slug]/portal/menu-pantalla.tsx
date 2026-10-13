"use client";

import { useEffect, useRef, useState } from "react";
import {
  cerrarSesion,
  fetchCalendario,
  type PortalSesion,
} from "@/lib/portal-api";
import BotonWhatsApp from "./boton-whatsapp";
import { CLASE_BOTON_CIRCULAR } from "./encabezado-pantalla";
import { OPCION, WRAPPER } from "./estilos";

interface Props {
  slug: string;
  sesion: PortalSesion;
  onCrear: () => void;
  onVerPedidos: () => void;
  onModificar: () => void;
  onCambiarCliente: () => void;
  onCerrada: () => void;
}

const ITEM_MENU =
  "flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-mayoreo-ink transition active:opacity-80 disabled:opacity-50";

// Menú del portal: Crear pedido (4d), Ver mis pedidos (4e) y Modificar pedido activo (4f).
export default function MenuPantalla({
  slug,
  sesion,
  onCrear,
  onVerPedidos,
  onModificar,
  onCambiarCliente,
  onCerrada,
}: Props) {
  const [cerrando, setCerrando] = useState(false);
  // Menú de la cuenta (cambiar de cliente / cerrar sesión): se cierra al tocar fuera, con Escape o al elegir una opción.
  const [menuAbierto, setMenuAbierto] = useState(false);
  const cuentaRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!menuAbierto) return;
    const fuera = (e: MouseEvent | TouchEvent) => {
      if (!cuentaRef.current?.contains(e.target as Node)) setMenuAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("touchstart", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("touchstart", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [menuAbierto]);

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
    <main className={WRAPPER}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-mayoreo-ink-soft">
            {sesion.negocio.nombre}
          </p>
          <h1 className="text-xl font-bold">Hola, {sesion.cliente?.nombre}</h1>
        </div>
        <div ref={cuentaRef} className="relative shrink-0">
          <button
            type="button"
            aria-label="Tu cuenta"
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
            className={CLASE_BOTON_CIRCULAR}
            onClick={() => setMenuAbierto((a) => !a)}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
            </svg>
          </button>
          {menuAbierto && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-2 flex w-56 flex-col divide-y divide-mayoreo-border overflow-hidden rounded-xl border border-mayoreo-border bg-mayoreo-card shadow-lg"
            >
              {sesion.clientes.length > 1 && (
                <button
                  type="button"
                  role="menuitem"
                  className={ITEM_MENU}
                  onClick={() => {
                    setMenuAbierto(false);
                    onCambiarCliente();
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />
                  </svg>
                  Cambiar de cliente
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className={ITEM_MENU}
                disabled={cerrando}
                onClick={() => {
                  setMenuAbierto(false);
                  void cerrar();
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                {cerrando ? "Cerrando…" : "Cerrar sesión"}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <button className={OPCION} onClick={onCrear}>
          <span className="text-base font-semibold">Crear pedido</span>
          <span className="text-sm text-mayoreo-ink-soft">
            Elige tus días de entrega y tus productos
          </span>
        </button>
        <button className={OPCION} onClick={onModificar}>
          <span className="text-base font-semibold">
            Modificar pedido activo
          </span>
          <span className="text-sm text-mayoreo-ink-soft">
            Cambia cantidades, quita o agrega días
          </span>
        </button>
        <button className={OPCION} onClick={onVerPedidos}>
          <span className="text-base font-semibold">Ver mis pedidos</span>
          <span className="text-sm text-mayoreo-ink-soft">
            Revisa tus pedidos activos y anteriores
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
