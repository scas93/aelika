"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  fetchNotificacionCanales,
  fetchNotificacionEventos,
  type NotificacionCanalConfig,
  type NotificacionEventoConfig,
} from "@/lib/api";
import VolverAjustesLink from "../volver-link";
import NotificacionesCanalesSection from "./canales-section";
import NotificacionesEventosSection from "./eventos-section";

export default function NotificacionesAjustesPage() {
  const { user, token } = useSession();
  const [canales, setCanales] = useState<NotificacionCanalConfig[] | null>(null);
  const [eventos, setEventos] = useState<NotificacionEventoConfig[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [canalesData, eventosData] = await Promise.all([fetchNotificacionCanales(token), fetchNotificacionEventos(token)]);
      setCanales(canalesData);
      setEventos(eventosData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la configuración de notificaciones");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
  }, [load]);

  // Conectar Telegram abre t.me/... en una pestaña nueva — cuando el
  // usuario vuelve a esta pestaña (ya conectó desde Telegram), se refresca
  // solo, sin que tenga que recargar la página a mano.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        load();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, [load]);

  if (user.rol !== "DUENO") {
    return (
      <div className="flex flex-col gap-4">
        <VolverAjustesLink />
        <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede editar los ajustes.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <VolverAjustesLink />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <NotificacionesCanalesSection token={token} canales={canales} onChange={load} />
      <NotificacionesEventosSection token={token} canales={canales} eventos={eventos} onChange={load} />
    </div>
  );
}
