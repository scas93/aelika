"use client";

import { useState } from "react";
import {
  ApiError,
  createNotificacionCanal,
  updateNotificacionCanal,
  type DestinatarioWhatsapp,
  type NotificacionCanalConfig,
} from "@/lib/api";
import Aviso from "../../_components/Aviso";
import Badge from "../../_components/Badge";
import Button from "../../_components/Button";
import ToggleSwitch from "../../_components/ToggleSwitch";
import { CanalCardShell } from "./canal-card-shell";

const MAX_DESTINATARIOS = 10;
const MAX_NOMBRE = 60;

// Fila en edición: `id` solo existe en las que ya estaban guardadas (el backend lo conserva); las nuevas no lo traen.
interface Fila {
  id?: string;
  nombre: string;
  telefono: string;
}

function destinatariosGuardados(canal: NotificacionCanalConfig | null): DestinatarioWhatsapp[] {
  const lista = canal?.config.destinatarios;
  return Array.isArray(lista) ? (lista as DestinatarioWhatsapp[]) : [];
}

const aFilas = (lista: DestinatarioWhatsapp[]): Fila[] => lista.map((d) => ({ id: d.id, nombre: d.nombre, telefono: d.telefono }));

export default function WhatsappCard({
  token,
  canal,
  tieneWebhook,
  cargado,
  onChange,
}: {
  token: string;
  canal: NotificacionCanalConfig | null;
  tieneWebhook: boolean;
  cargado: boolean;
  onChange: () => Promise<void>;
}) {
  const guardados = destinatariosGuardados(canal);
  const firmaGuardada = JSON.stringify(guardados.map((d) => [d.id, d.nombre, d.telefono]));

  const [filas, setFilas] = useState<Fila[]>(() => aFilas(guardados));
  // Si el canal cambia desde fuera (se guardó, otra pestaña), la lista local se vuelve a alinear con lo guardado.
  const [firmaVista, setFirmaVista] = useState(firmaGuardada);
  if (firmaVista !== firmaGuardada) {
    setFirmaVista(firmaGuardada);
    setFilas(aFilas(guardados));
  }

  const [guardando, setGuardando] = useState(false);
  const [cambiandoActivo, setCambiandoActivo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activo = canal?.activo ?? false;
  const sucio = JSON.stringify(filas.map((f) => [f.id, f.nombre.trim(), f.telefono.trim()])) !== firmaGuardada;
  const filasValidas = filas.every((f) => f.nombre.trim().length > 0 && f.telefono.trim().length > 0);
  // No se puede encender sin webhook ni sin al menos un destinatario GUARDADO; apagar siempre se puede.
  const puedeEncender = tieneWebhook && guardados.length > 0 && !sucio;

  function actualizar(i: number, cambio: Partial<Fila>) {
    setFilas((prev) => prev.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  }

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    if (!filasValidas) return;
    setGuardando(true);
    setError(null);
    try {
      const config = { destinatarios: filas.map((f) => ({ ...(f.id ? { id: f.id } : {}), nombre: f.nombre.trim(), telefono: f.telefono.trim() })) };
      if (canal) await updateNotificacionCanal(token, canal.id, { config });
      // El canal nace apagado: se enciende con el interruptor, cuando ya hay destinatarios y webhook.
      else await createNotificacionCanal(token, { tipo: "WHATSAPP", config, activo: false });
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar los destinatarios");
    } finally {
      setGuardando(false);
    }
  }

  async function handleActivo() {
    if (!canal) return;
    setCambiandoActivo(true);
    setError(null);
    try {
      await updateNotificacionCanal(token, canal.id, { activo: !activo });
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el estado del canal");
    } finally {
      setCambiandoActivo(false);
    }
  }

  return (
    <CanalCardShell emoji="📲" iconBg="#DCFCE7" iconColor="#16A34A" titulo="WhatsApp (avisos internos)">
      {activo ? <Badge variant="exito">Activo</Badge> : <Badge variant="neutro">{canal ? "Inactivo" : "Sin configurar"}</Badge>}

      <p className="text-sm text-admin-ink-soft">
        Avisos para las personas de tu equipo que agregues aquí (no son clientes). Salen por la misma conexión de WhatsApp de tu
        negocio, sin credenciales aparte.
      </p>

      {cargado && !tieneWebhook && (
        <Aviso tono="ambar" accion={{ label: "Ir a Conexión WhatsApp", href: "/dashboard/ajustes/conexion-whatsapp" }}>
          Falta la URL del webhook de tu conexión de WhatsApp: sin ella no se puede activar este canal.
        </Aviso>
      )}

      <form onSubmit={handleGuardar} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          {filas.length === 0 && <p className="text-xs text-admin-ink-soft">Aún no hay destinatarios.</p>}
          {filas.map((f, i) => (
            <div key={f.id ?? `nueva-${i}`} className="flex flex-col gap-2 md:flex-row md:items-center">
              <input
                value={f.nombre}
                onChange={(e) => actualizar(i, { nombre: e.target.value })}
                maxLength={MAX_NOMBRE}
                placeholder="Nombre"
                aria-label={`Nombre del destinatario ${i + 1}`}
                className="admin-input md:flex-1"
              />
              <input
                value={f.telefono}
                onChange={(e) => actualizar(i, { telefono: e.target.value })}
                placeholder="55 1234 5678 o +1 818 814 0000"
                inputMode="tel"
                aria-label={`Teléfono del destinatario ${i + 1}`}
                className="admin-input md:flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                size="barra"
                onClick={() => setFilas((prev) => prev.filter((_, j) => j !== i))}
                aria-label={`Quitar al destinatario ${i + 1}`}
              >
                Quitar
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-admin-ink-soft">
          México: 10 dígitos. Otro país: empieza con + y el código de país. Máximo {MAX_DESTINATARIOS} destinatarios.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="barra"
            disabled={filas.length >= MAX_DESTINATARIOS}
            onClick={() => setFilas((prev) => [...prev, { nombre: "", telefono: "" }])}
          >
            Agregar destinatario
          </Button>
          <Button type="submit" size="barra" disabled={guardando || !sucio || !filasValidas}>
            {guardando ? "Guardando..." : "Guardar"}
          </Button>
          {canal && (
            <label className="ml-auto flex items-center gap-2 text-sm font-semibold text-admin-ink">
              {activo ? "Activo" : "Inactivo"}
              <ToggleSwitch
                checked={activo}
                onChange={() => {
                  // Encender exige webhook y destinatarios guardados; apagar nunca se bloquea.
                  if (cambiandoActivo || (!activo && !puedeEncender)) return;
                  void handleActivo();
                }}
                label={activo ? "Desactivar WhatsApp" : "Activar WhatsApp"}
              />
            </label>
          )}
        </div>
        {canal && !activo && tieneWebhook && !puedeEncender && (
          <p className="text-xs text-admin-ink-soft">Guarda al menos un destinatario para poder activar el canal.</p>
        )}
      </form>
    </CanalCardShell>
  );
}
