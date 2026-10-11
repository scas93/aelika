"use client";

import { useState } from "react";
import { cerrarSesion, type PortalSesion } from "@/lib/portal-api";
import { BTN_PRIMARIO, BTN_SECUNDARIO, CARD } from "./estilos";

interface Props {
  slug: string;
  sesion: PortalSesion;
  onCambiarCliente: () => void;
  onCerrada: () => void;
}

// Pantalla provisional de la 4b: confirma quién entró. El menú (Crear / Modificar / Ver pedidos) llega en las
// siguientes entregas.
export default function BienvenidaPantalla({
  slug,
  sesion,
  onCambiarCliente,
  onCerrada,
}: Props) {
  const [cerrando, setCerrando] = useState(false);

  async function cerrar() {
    setCerrando(true);
    try {
      await cerrarSesion(slug);
    } catch {
      // Aunque falle la red, se vuelve al acceso: la cookie la borra el servidor al cerrar o vencer.
    }
    onCerrada();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 bg-mayoreo-bg p-4 font-mayoreo text-mayoreo-ink">
      <div className={CARD}>
        <div>
          <p className="text-sm text-mayoreo-ink-soft">
            {sesion.negocio.nombre}
          </p>
          <h1 className="text-xl font-bold">Hola, {sesion.cliente?.nombre}</h1>
          <p className="text-xs text-mayoreo-ink-soft">
            Teléfono terminado en {sesion.telefonoTerminacion}
          </p>
        </div>
        <p className="text-sm text-mayoreo-ink-soft">
          Ya entraste a tu cuenta. Muy pronto podrás crear y consultar tus
          pedidos desde aquí.
        </p>
        {sesion.clientes.length > 1 && (
          <button className={BTN_SECUNDARIO} onClick={onCambiarCliente}>
            Cambiar de cliente
          </button>
        )}
        <button
          className={BTN_PRIMARIO}
          disabled={cerrando}
          onClick={() => void cerrar()}
        >
          {cerrando ? "Cerrando…" : "Cerrar sesión"}
        </button>
      </div>
    </main>
  );
}
