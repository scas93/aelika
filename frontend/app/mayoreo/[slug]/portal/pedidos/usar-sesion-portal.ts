"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  fetchCalendario,
  fetchSesion,
  type PortalSesion,
} from "@/lib/portal-api";
import { rutaBasePortal } from "@/lib/portal-pedidos-formato";

/**
 * Sesión del portal para las páginas con su propia URL (Ver mis pedidos). Sin sesión válida, o con un teléfono en
 * varios clientes que todavía no elige, vuelve a la raíz del portal, que ya sabe resolver ambos casos.
 */
export function useSesionPortal(slug: string) {
  const router = useRouter();
  const pathname = usePathname();
  const base = rutaBasePortal(pathname, slug);
  const [sesion, setSesion] = useState<PortalSesion | null>(null);
  const [numeroAtencion, setNumeroAtencion] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    fetchSesion(slug)
      .then((s) => {
        if (!activo) return;
        if (!s.cliente || s.requiereSeleccion) router.replace(base);
        else setSesion(s);
      })
      .catch(() => {
        if (activo) router.replace(base);
      });
    // Solo para el botón de WhatsApp: si falla, simplemente no aparece.
    fetchCalendario(slug)
      .then((c) => {
        if (activo) setNumeroAtencion(c.numeroAtencion);
      })
      .catch(() => undefined);
    return () => {
      activo = false;
    };
  }, [slug, base, router]);

  return { sesion, numeroAtencion, base, router };
}
