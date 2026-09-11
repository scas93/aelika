"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// "/dashboard/notificaciones" es solo el encabezado de grupo en el sidebar
// (ver nav-items.ts) — no tiene contenido propio, redirige al primer hijo
// para que no sea una pantalla en blanco si alguien llega aquí directo
// (ej. escribiendo la URL a mano).
export default function NotificacionesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/notificaciones/recontacto");
  }, [router]);

  return null;
}
