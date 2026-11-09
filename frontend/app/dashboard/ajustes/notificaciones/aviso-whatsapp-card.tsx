"use client";

import { useState } from "react";
import {
  ApiError,
  createNotificacionCanal,
  updateNotificacionCanal,
  type DestinatarioWhatsapp,
  type NotificacionCanalConfig,
  type NotificacionEventoConfig,
} from "@/lib/api";
import Button from "../../_components/Button";
import AvisoCard from "./aviso-card";
import { apagarAviso, avisoEncendido, encenderAviso } from "./aviso-activacion";

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

/**
 * «Pedido modificado por un cliente»: aviso por WhatsApp al equipo cuando un cliente cambia su pedido desde el portal. Por dentro
 * es el canal WhatsApp + el evento PEDIDO_MODIFICADO_CLIENTE; aquí es un solo interruptor con sus destinatarios.
 */
export default function AvisoWhatsappCard({
  token,
  canal,
  evento,
  tieneWebhook,
  onChange,
}: {
  token: string;
  canal: NotificacionCanalConfig | null;
  evento: NotificacionEventoConfig | null;
  tieneWebhook: boolean;
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
  const [cambiando, setCambiando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const encendido = avisoEncendido(canal, evento);
  const sucio = JSON.stringify(filas.map((f) => [f.id, f.nombre.trim(), f.telefono.trim()])) !== firmaGuardada;
  const filasValidas = filas.every((f) => f.nombre.trim().length > 0 && f.telefono.trim().length > 0);

  const faltan: string[] = [];
  if (!tieneWebhook) faltan.push("Falta conectar tu WhatsApp para poder encenderlo.");
  if (guardados.length === 0) faltan.push("Agrega al menos un destinatario para poder encenderlo.");
  else if (sucio) faltan.push("Guarda los cambios para poder encenderlo.");

  const destino =
    guardados.length === 0
      ? "Nadie todavía"
      : `${guardados.length} ${guardados.length === 1 ? "persona" : "personas"}: ${guardados.map((d) => d.nombre).join(", ")}`;

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
      // El canal nace apagado: se enciende con el interruptor, cuando ya hay destinatarios guardados y conexión de WhatsApp.
      else await createNotificacionCanal(token, { tipo: "WHATSAPP", config, activo: false });
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron guardar los destinatarios");
    } finally {
      setGuardando(false);
    }
  }

  async function handleInterruptor() {
    if (cambiando) return;
    setCambiando(true);
    setError(null);
    try {
      if (encendido) await apagarAviso(token, canal, evento);
      else if (canal) await encenderAviso(token, canal, evento, { evento: "PEDIDO_MODIFICADO_CLIENTE", audiencia: "NEGOCIO" });
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el aviso");
    } finally {
      setCambiando(false);
    }
  }

  return (
    <AvisoCard
      titulo="Pedido modificado por un cliente"
      descripcion="Aviso por WhatsApp cuando un cliente cambia su pedido desde su portal."
      encendido={encendido}
      destino={destino}
      faltan={faltan}
      enlaceFalta={!tieneWebhook ? { label: "Ir a Conexión WhatsApp", href: "/dashboard/ajustes/conexion-whatsapp" } : undefined}
      ocupado={cambiando || !canal}
      onInterruptor={() => void handleInterruptor()}
    >
      <form onSubmit={handleGuardar} className="flex flex-col gap-3 border-t border-admin-border pt-3">
        <span className="text-xs font-semibold text-admin-ink-soft">Personas de tu equipo que reciben el aviso</span>
        <div className="flex flex-col gap-2">
          {filas.length === 0 && <p className="text-xs text-admin-ink-soft">Aún no hay destinatarios.</p>}
          {filas.map((f, i) => (
            <div key={f.id ?? `nueva-${i}`} className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
              <input
                value={f.nombre}
                onChange={(e) => actualizar(i, { nombre: e.target.value })}
                maxLength={MAX_NOMBRE}
                placeholder="Nombre"
                aria-label={`Nombre del destinatario ${i + 1}`}
                className="admin-input w-full min-w-0 truncate md:flex-1"
              />
              <input
                value={f.telefono}
                onChange={(e) => actualizar(i, { telefono: e.target.value })}
                placeholder="55 1234 5678 o +1 818 814 0000"
                inputMode="tel"
                aria-label={`Teléfono del destinatario ${i + 1}`}
                className="admin-input w-full min-w-0 truncate md:flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                size="barra"
                onClick={() => setFilas((prev) => prev.filter((_, j) => j !== i))}
                aria-label={`Quitar al destinatario ${i + 1}`}
                className="shrink-0 self-start md:self-auto"
              >
                Quitar
              </Button>
            </div>
          ))}
        </div>
        <p className="break-words text-xs text-admin-ink-soft">
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
            {guardando ? "Guardando..." : "Guardar destinatarios"}
          </Button>
        </div>
      </form>
    </AvisoCard>
  );
}
