"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchPublicPedidoB2bTenant } from "@/lib/api";
import { PortalError, fetchSesion, type PortalSesion } from "@/lib/portal-api";
import AccesoPantalla from "./portal/acceso-pantalla";
import MenuPantalla from "./portal/menu-pantalla";
import CrearPedido from "./portal/crear/crear-pedido";
import ElegirClientePantalla from "./portal/elegir-cliente-pantalla";

type Estado =
  | { tipo: "cargando" }
  | { tipo: "sin-sesion"; aviso: string | null }
  | { tipo: "no-encontrado" }
  | { tipo: "error"; mensaje: string }
  | {
      tipo: "sesion";
      sesion: PortalSesion;
      cambiando: boolean;
      vista: "menu" | "crear";
    };

const MENSAJE_SESION_TERMINADA =
  "Tu sesión terminó. Vuelve a entrar con tu teléfono";

// Portal del cliente B2B (Fase 4): acceso con teléfono + código de WhatsApp, elección de cliente, menú y crear pedido
// (4d). Sin sesión siempre se muestra el acceso.
// Resuelve el estado inicial o posterior a una acción. Sin setState aquí: lo aplica quien llama.
async function resolverEstado(
  slug: string,
  avisoSiNoHay: string | null,
): Promise<Estado> {
  try {
    const sesion = await fetchSesion(slug);
    return { tipo: "sesion", sesion, cambiando: false, vista: "menu" };
  } catch (e) {
    if (e instanceof PortalError && e.status === 401)
      return { tipo: "sin-sesion", aviso: avisoSiNoHay };
    if (e instanceof PortalError && e.status === 404)
      return { tipo: "no-encontrado" };
    return {
      tipo: "error",
      mensaje: e instanceof Error ? e.message : "Algo salió mal",
    };
  }
}

export default function PortalPage() {
  const { slug } = useParams<{ slug: string }>();
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [nombrePublico, setNombrePublico] = useState("Mayoreo");

  const recargar = useCallback(
    (aviso: string | null = null) => {
      void resolverEstado(slug, aviso).then(setEstado);
    },
    [slug],
  );

  useEffect(() => {
    let activo = true;
    void resolverEstado(slug, null).then((e) => {
      if (activo) setEstado(e);
    });
    // Nombre del negocio para la pantalla de acceso (info pública que ya existe); si falla, queda el genérico.
    fetchPublicPedidoB2bTenant(slug)
      .then((t) => {
        if (activo) setNombrePublico(t.nombre);
      })
      .catch(() => undefined);
    return () => {
      activo = false;
    };
  }, [slug]);

  const nombreNegocio =
    estado.tipo === "sesion" ? estado.sesion.negocio.nombre : nombrePublico;

  if (estado.tipo === "cargando") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mayoreo-bg font-mayoreo">
        <p className="text-mayoreo-ink-soft">Cargando…</p>
      </main>
    );
  }
  if (estado.tipo === "no-encontrado") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mayoreo-bg p-4 font-mayoreo">
        <p className="text-mayoreo-ink-soft">No encontramos este negocio.</p>
      </main>
    );
  }
  if (estado.tipo === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-mayoreo-bg p-4 font-mayoreo">
        <p className="text-mayoreo-ink-soft">{estado.mensaje}</p>
        <button className="text-sm underline" onClick={() => recargar()}>
          Reintentar
        </button>
      </main>
    );
  }
  if (estado.tipo === "sin-sesion") {
    return (
      <AccesoPantalla
        slug={slug}
        negocio={nombreNegocio}
        aviso={estado.aviso}
        onEntro={() => recargar(MENSAJE_SESION_TERMINADA)}
      />
    );
  }

  const { sesion } = estado;
  if (sesion.requiereSeleccion || estado.cambiando) {
    return (
      <ElegirClientePantalla
        slug={slug}
        sesion={sesion}
        onElegido={() => recargar(MENSAJE_SESION_TERMINADA)}
        onSesionTerminada={() =>
          setEstado({ tipo: "sin-sesion", aviso: MENSAJE_SESION_TERMINADA })
        }
      />
    );
  }
  if (estado.vista === "crear") {
    return (
      <CrearPedido
        slug={slug}
        sesion={sesion}
        onSalir={() => setEstado({ ...estado, vista: "menu" })}
        onSesionTerminada={() =>
          setEstado({ tipo: "sin-sesion", aviso: MENSAJE_SESION_TERMINADA })
        }
      />
    );
  }
  return (
    <MenuPantalla
      slug={slug}
      sesion={sesion}
      onCrear={() => setEstado({ ...estado, vista: "crear" })}
      onCambiarCliente={() => setEstado({ ...estado, cambiando: true })}
      onCerrada={() => setEstado({ tipo: "sin-sesion", aviso: null })}
    />
  );
}
