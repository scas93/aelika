"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  conectarTelegram,
  createNotificacionCanal,
  deleteNotificacionCanal,
  updateNotificacionCanal,
  type NotificacionCanalConfig,
} from "@/lib/api";
import Card from "../../_components/Card";
import Button from "../../_components/Button";
import Badge from "../../_components/Badge";
import Modal from "../../_components/Modal";

const SECTION_HEADER = "text-[13px] font-semibold uppercase tracking-wide text-admin-ink-soft";

export default function NotificacionesCanalesSection({
  token,
  canales,
  onChange,
}: {
  token: string;
  canales: NotificacionCanalConfig[] | null;
  onChange: () => Promise<void>;
}) {
  const telegram = canales?.find((c) => c.tipo === "TELEGRAM") ?? null;
  const correo = canales?.find((c) => c.tipo === "CORREO") ?? null;

  return (
    <section id="canales" className="flex flex-col gap-3 scroll-mt-6">
      <h2 className={SECTION_HEADER}>Canales</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TelegramCard token={token} canal={telegram} onChange={onChange} />
        <CorreoCard token={token} canal={correo} onChange={onChange} />
      </div>
    </section>
  );
}

function CanalCardShell({
  emoji,
  iconBg,
  iconColor,
  titulo,
  children,
}: {
  emoji: string;
  iconBg: string;
  iconColor: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
          style={{ backgroundColor: iconBg, color: iconColor }}
        >
          {emoji}
        </span>
        <span className="text-sm font-extrabold text-admin-ink">{titulo}</span>
      </div>
      {children}
    </Card>
  );
}

function TelegramCard({
  token,
  canal,
  onChange,
}: {
  token: string;
  canal: NotificacionCanalConfig | null;
  onChange: () => Promise<void>;
}) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const conectado = canal?.conectado ?? false;

  async function handleConectar() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await conectarTelegram(token);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo generar el link de conexión");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDesconectar() {
    if (!canal) return;
    setDisconnecting(true);
    setError(null);
    try {
      await deleteNotificacionCanal(token, canal.id);
      await onChange();
      setConfirmingDisconnect(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo desconectar Telegram");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <CanalCardShell emoji="💬" iconBg="#DBEAFE" iconColor="#3B82F6" titulo="Telegram">
      {conectado ? (
        <Badge color="bg-admin-green-soft text-admin-green-dark">Conectado</Badge>
      ) : (
        <Badge color="bg-admin-bg text-admin-ink-soft">No conectado</Badge>
      )}

      <p className="text-sm text-admin-ink-soft">
        Recibe avisos de Telegram en el chat que conectes — usa un bot propio de Aelika, no el bot que atiende a tus
        clientes.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {conectado ? (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleConectar} disabled={connecting}>
            {connecting ? "Generando link..." : "Reconectar"}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setConfirmingDisconnect(true)}>
            Desconectar
          </Button>
        </div>
      ) : (
        <Button variant="primary" size="sm" onClick={handleConectar} disabled={connecting} className="self-start">
          {connecting ? "Generando link..." : "Conectar con Telegram"}
        </Button>
      )}

      <Modal
        open={confirmingDisconnect}
        onClose={() => setConfirmingDisconnect(false)}
        title="¿Desconectar Telegram?"
        footer={
          <>
            <Button variant="primary" onClick={handleDesconectar} disabled={disconnecting}>
              {disconnecting ? "Desconectando..." : "Sí, desconectar"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmingDisconnect(false)} disabled={disconnecting}>
              Cancelar
            </Button>
          </>
        }
      >
        <p className="text-sm text-admin-ink-soft">
          Los eventos que estén configurados para avisarte por Telegram dejarán de enviarse hasta que vuelvas a
          conectar.
        </p>
      </Modal>
    </CanalCardShell>
  );
}

function CorreoCard({
  token,
  canal,
  onChange,
}: {
  token: string;
  canal: NotificacionCanalConfig | null;
  onChange: () => Promise<void>;
}) {
  const nombreRemitenteActual = typeof canal?.config.nombreRemitente === "string" ? canal.config.nombreRemitente : "";
  const correoDestinoActual = typeof canal?.config.correoDestino === "string" ? canal.config.correoDestino : "";

  const [nombreRemitente, setNombreRemitente] = useState(nombreRemitenteActual);
  const [correoDestino, setCorreoDestino] = useState(correoDestinoActual);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local form state when the loaded canal changes (initial fetch, or after a save elsewhere)
    setNombreRemitente(nombreRemitenteActual);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCorreoDestino(correoDestinoActual);
  }, [nombreRemitenteActual, correoDestinoActual]);

  const configurado = nombreRemitenteActual.length > 0;
  const dirty = nombreRemitente.trim() !== nombreRemitenteActual || correoDestino.trim() !== correoDestinoActual;

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombreRemitente.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const config = { nombreRemitente: nombreRemitente.trim(), correoDestino: correoDestino.trim() || undefined };
      if (canal) {
        await updateNotificacionCanal(token, canal.id, { config });
      } else {
        await createNotificacionCanal(token, { tipo: "CORREO", config });
      }
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la configuración de correo");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CanalCardShell emoji="✉️" iconBg="#EDE9FE" iconColor="#8B5CF6" titulo="Correo">
      {configurado ? (
        <Badge color="bg-admin-green-soft text-admin-green-dark">Configurado</Badge>
      ) : (
        <Badge color="bg-admin-bg text-admin-ink-soft">Sin configurar</Badge>
      )}

      <p className="text-sm text-admin-ink-soft">
        El correo sale siempre desde el dominio de Aelika (<span className="font-mono">notificaciones@aelika.com</span>),
        no desde tu dominio propio — el nombre de remitente es lo único que tus clientes ven.
      </p>

      <form onSubmit={handleGuardar} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Nombre de remitente
          <input
            value={nombreRemitente}
            onChange={(e) => setNombreRemitente(e.target.value)}
            placeholder="Entredós Café"
            className="admin-input"
          />
          <span className="text-xs font-normal text-admin-ink-soft">Así se identifica tu negocio ante tus clientes.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Correo destino (opcional)
          <input
            type="email"
            value={correoDestino}
            onChange={(e) => setCorreoDestino(e.target.value)}
            placeholder="pedidos@tunegocio.com"
            className="admin-input"
          />
          <span className="text-xs font-normal text-admin-ink-soft">
            A dónde te llegan a ti los avisos de tu propio negocio (ej. pago confirmado).
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" size="sm" disabled={submitting || !dirty || !nombreRemitente.trim()} className="self-start">
          {submitting ? "Guardando..." : "Guardar"}
        </Button>
      </form>
    </CanalCardShell>
  );
}
