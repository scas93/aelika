"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  fetchNotificacionCanales,
  fetchNotificacionEventos,
  fetchTenantSettings,
  type NotificacionCanalConfig,
  type NotificacionEventoConfig,
} from "@/lib/api";
import { mensajeSinAcceso } from "../acceso";
import VolverAjustesLink from "../volver-link";
import NotificacionesCanalesSection from "./canales-section";
import NotificacionesEventosSection from "./eventos-section";

export default function NotificacionesAjustesPage() {
  const { user, token } = useSession();
  const [canales, setCanales] = useState<NotificacionCanalConfig[] | null>(null);
  const [eventos, setEventos] = useState<NotificacionEventoConfig[] | null>(null);
  const [tieneWebhook, setTieneWebhook] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const esMayoreo = user.tenant.tipoStorefront === "RETAIL_B2B";
  const esAdmin = user.rol === "DUENO";

  const load = useCallback(async () => {
    // Quien no es Admin ve el mensaje de acceso y no dispara ninguna llamada (el backend igual respondería 403).
    if (!esAdmin) return;
    try {
      const [canalesData, eventosData, ajustes] = await Promise.all([
        fetchNotificacionCanales(token),
        fetchNotificacionEventos(token),
        // Solo mayoreo necesita saber si hay webhook (el canal WhatsApp no se activa sin él); los demás no hacen la llamada.
        esMayoreo ? fetchTenantSettings(token) : Promise.resolve(null),
      ]);
      setCanales(canalesData);
      setEventos(eventosData);
      setTieneWebhook(Boolean(ajustes?.botWebhookUrl?.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la configuración de notificaciones");
    }
     
  }, [token, esAdmin, esMayoreo]);

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
        <p className="text-sm text-admin-ink-soft">{mensajeSinAcceso(user.rol)}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <VolverAjustesLink />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <NotificacionesCanalesSection token={token} canales={canales} esMayoreo={esMayoreo} tieneWebhook={tieneWebhook} onChange={load} />
      <NotificacionesEventosSection token={token} canales={canales} eventos={eventos} esMayoreo={esMayoreo} onChange={load} />
    </div>
  );
}
