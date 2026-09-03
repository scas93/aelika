"use client";

import { useState } from "react";
import {
  ApiError,
  createNotificacionEvento,
  deleteNotificacionEvento,
  updateNotificacionEvento,
  type NotificacionAudiencia,
  type NotificacionCanalConfig,
  type NotificacionEvento,
  type NotificacionEventoConfig,
} from "@/lib/api";
import Card from "../../_components/Card";
import ToggleSwitch from "../../_components/ToggleSwitch";

const SECTION_HEADER = "text-[13px] font-semibold uppercase tracking-wide text-admin-ink-soft";

const EVENTO_LABEL: Record<NotificacionEvento, string> = {
  PEDIDO_RECIBIDO: "Pedido recibido",
  PAGO_CONFIRMADO: "Pago confirmado",
  PEDIDO_CONFIRMADO: "Pedido confirmado",
  PEDIDO_EN_CAMINO: "Pedido en camino",
  PEDIDO_ENTREGADO: "Pedido entregado",
};

const CANAL_LABEL: Record<string, string> = {
  TELEGRAM: "Telegram",
  CORREO: "Correo",
};

interface EventoDef {
  evento: NotificacionEvento;
  audiencia: NotificacionAudiencia;
}

const EVENTOS_NEGOCIO: EventoDef[] = [
  { evento: "PEDIDO_RECIBIDO", audiencia: "NEGOCIO" },
  { evento: "PAGO_CONFIRMADO", audiencia: "NEGOCIO" },
];

const EVENTOS_CLIENTE: EventoDef[] = [
  { evento: "PEDIDO_CONFIRMADO", audiencia: "CLIENTE" },
  { evento: "PEDIDO_EN_CAMINO", audiencia: "CLIENTE" },
  { evento: "PEDIDO_ENTREGADO", audiencia: "CLIENTE" },
];

/**
 * Canales que se pueden ofrecer para un evento de esta audiencia — nunca
 * Telegram para CLIENTE (sin mecanismo de conexión de clientes, ver
 * CLAUDE.md Fase D), y solo canales que ya tienen lo necesario para enviar:
 * Telegram conectado, Correo con el campo que esa audiencia necesita
 * (nombreRemitente para escribirle al cliente, correoDestino para que le
 * llegue al negocio).
 */
function canalesDisponibles(canales: NotificacionCanalConfig[], audiencia: NotificacionAudiencia) {
  return canales.filter((c) => {
    if (c.tipo === "TELEGRAM") return audiencia === "NEGOCIO" && c.conectado;
    if (c.tipo === "CORREO") {
      const campo = audiencia === "NEGOCIO" ? c.config.correoDestino : c.config.nombreRemitente;
      return typeof campo === "string" && campo.length > 0;
    }
    return false;
  });
}

export default function NotificacionesEventosSection({
  token,
  canales,
  eventos,
  onChange,
}: {
  token: string;
  canales: NotificacionCanalConfig[] | null;
  eventos: NotificacionEventoConfig[] | null;
  onChange: () => Promise<void>;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className={SECTION_HEADER}>Eventos</h2>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-bold text-admin-ink-soft">Para tu negocio</h3>
        <Card padding={0} className="overflow-hidden">
          <ul className="flex flex-col divide-y divide-admin-border">
            {EVENTOS_NEGOCIO.map((def) => (
              <EventoRow key={def.evento} def={def} token={token} canales={canales} eventos={eventos} onChange={onChange} />
            ))}
          </ul>
        </Card>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-bold text-admin-ink-soft">Para tus clientes</h3>
        <Card padding={0} className="overflow-hidden">
          <ul className="flex flex-col divide-y divide-admin-border">
            {EVENTOS_CLIENTE.map((def) => (
              <EventoRow key={def.evento} def={def} token={token} canales={canales} eventos={eventos} onChange={onChange} />
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}

function EventoRow({
  def,
  token,
  canales,
  eventos,
  onChange,
}: {
  def: EventoDef;
  token: string;
  canales: NotificacionCanalConfig[] | null;
  eventos: NotificacionEventoConfig[] | null;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = eventos?.find((e) => e.evento === def.evento && e.audiencia === def.audiencia) ?? null;
  const opciones = canales ? canalesDisponibles(canales, def.audiencia) : [];
  const activo = existing?.activo ?? false;
  const canalIdSeleccionado = existing?.canalConfigId ?? "";
  // Prendido pero apuntando a un canal que ya no está disponible (se
  // desconectó Telegram, o se borró el nombreRemitente/correoDestino que
  // ese canal necesitaba) — mismo aviso que "sin canal conectado" aunque
  // técnicamente sí haya una fila guardada.
  const sinCanalDisponible = activo && !opciones.some((c) => c.id === canalIdSeleccionado);

  async function handleToggle() {
    if (!existing) return; // el toggle está deshabilitado sin canal elegido, ver abajo
    setBusy(true);
    setError(null);
    try {
      await updateNotificacionEvento(token, existing.id, { activo: !existing.activo });
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el evento");
    } finally {
      setBusy(false);
    }
  }

  async function handleCanalChange(nuevoId: string) {
    setBusy(true);
    setError(null);
    try {
      if (!nuevoId) {
        if (existing) await deleteNotificacionEvento(token, existing.id);
      } else if (existing) {
        await updateNotificacionEvento(token, existing.id, { canalConfigId: nuevoId });
      } else {
        // Elegir un canal desde "Ninguno" activa el evento de una vez —
        // elegir un canal es la señal de que sí se quiere este aviso.
        await createNotificacionEvento(token, { evento: def.evento, audiencia: def.audiencia, canalConfigId: nuevoId, activo: true });
      }
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el evento");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-admin-ink">{EVENTO_LABEL[def.evento]}</span>
          {def.audiencia === "CLIENTE" && (
            <span className="text-xs text-admin-ink-soft">
              Depende de que el pedido tenga correo de facturación capturado.
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <select
            value={canalIdSeleccionado}
            onChange={(e) => handleCanalChange(e.target.value)}
            disabled={busy}
            className="admin-input w-40"
          >
            <option value="">Ninguno</option>
            {opciones.map((c) => (
              <option key={c.id} value={c.id}>
                {CANAL_LABEL[c.tipo]}
              </option>
            ))}
          </select>
          <ToggleSwitch
            checked={activo}
            onChange={handleToggle}
            label={activo ? `Desactivar ${EVENTO_LABEL[def.evento]}` : `Activar ${EVENTO_LABEL[def.evento]}`}
          />
        </div>
      </div>

      {def.audiencia === "CLIENTE" && (
        <p className="rounded-[var(--radius-admin-control)] bg-admin-bg px-3 py-2 text-xs text-admin-ink-soft">
          Este aviso se manda por correo al correo de facturación que el cliente capturó en su pedido. Si tu negocio
          tiene la facturación desactivada, tus clientes no van a recibir este aviso en la práctica.
        </p>
      )}

      {sinCanalDisponible && (
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-admin-control)] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span>Sin canal conectado, este aviso no se enviará.</span>
          <a href="#canales" className="shrink-0 font-semibold underline">
            Conectar un canal
          </a>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </li>
  );
}
