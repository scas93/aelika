"use client";

import type { NotificacionCanalConfig, NotificacionEventoConfig } from "@/lib/api";
import AvisoWhatsappCard from "./aviso-whatsapp-card";
import AvisoResumenNegocioCard from "./aviso-resumen-negocio-card";
import AvisoResumenClientesCard from "./aviso-resumen-clientes-card";

const GRUPO = "text-[13px] font-semibold uppercase tracking-wide text-admin-ink-soft";

/**
 * Ajustes → Notificaciones de un negocio de MAYOREO: una tarjeta completa por aviso, agrupadas por quién lo recibe. La persona no
 * ve canales ni eventos: cada tarjeta tiene un solo interruptor (por dentro maneja el canal y el evento juntos).
 */
export default function NotificacionesMayoreo({
  token,
  nombreNegocio,
  canales,
  eventos,
  tieneWebhook,
  onChange,
}: {
  token: string;
  nombreNegocio: string;
  canales: NotificacionCanalConfig[] | null;
  eventos: NotificacionEventoConfig[] | null;
  tieneWebhook: boolean;
  onChange: () => Promise<void>;
}) {
  if (canales === null || eventos === null) return <p className="text-sm text-admin-ink-soft">Cargando…</p>;

  const whatsapp = canales.find((c) => c.tipo === "WHATSAPP") ?? null;
  const correo = canales.find((c) => c.tipo === "CORREO") ?? null;
  const eventoDe = (evento: string) => eventos.find((e) => e.evento === evento && e.audiencia === "NEGOCIO") ?? null;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className={GRUPO}>Para tu equipo</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <AvisoWhatsappCard token={token} canal={whatsapp} evento={eventoDe("PEDIDO_MODIFICADO_CLIENTE")} tieneWebhook={tieneWebhook} onChange={onChange} />
          <AvisoResumenNegocioCard token={token} canal={correo} evento={eventoDe("RESUMEN_SEMANAL")} onChange={onChange} />
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className={GRUPO}>Para tus clientes</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <AvisoResumenClientesCard token={token} nombreNegocio={nombreNegocio} canales={canales} eventos={eventos} onChange={onChange} />
        </div>
      </section>
    </div>
  );
}
