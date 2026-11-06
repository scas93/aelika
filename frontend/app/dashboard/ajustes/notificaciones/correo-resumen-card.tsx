"use client";

import { useState } from "react";
import {
  ApiError,
  createNotificacionCanal,
  enviarResumenSemanalPrueba,
  updateNotificacionCanal,
  type NotificacionCanalConfig,
  type ResumenPruebaResultado,
} from "@/lib/api";
import Aviso from "../../_components/Aviso";
import Badge from "../../_components/Badge";
import Button from "../../_components/Button";
import ToggleSwitch from "../../_components/ToggleSwitch";
import { CanalCardShell } from "./canal-card-shell";

const MAX_CORREOS = 10;
const MAX_NOMBRE = 60;

function correosGuardados(canal: NotificacionCanalConfig | null): string[] {
  const lista = canal?.config.correos;
  return Array.isArray(lista) ? lista.filter((c): c is string => typeof c === "string") : [];
}

/**
 * Canal Correo de MAYOREO: la lista de direcciones (de 1 a 10) a las que llega el resumen semanal y el nombre del remitente.
 * Nace inactivo: se enciende con el interruptor cuando ya hay al menos una dirección guardada. El botón de prueba envía ahora
 * el resumen de la semana anterior (solo con lo guardado).
 */
export default function CorreoResumenCard({
  token,
  canal,
  onChange,
}: {
  token: string;
  canal: NotificacionCanalConfig | null;
  onChange: () => Promise<void>;
}) {
  const guardados = correosGuardados(canal);
  const nombreGuardado = typeof canal?.config.nombreRemitente === "string" ? canal.config.nombreRemitente : "";
  const firmaGuardada = JSON.stringify([nombreGuardado, guardados]);

  const [nombre, setNombre] = useState(nombreGuardado);
  const [correos, setCorreos] = useState<string[]>(guardados);
  // Si el canal cambia desde fuera (se guardó, otra pestaña), el formulario se vuelve a alinear con lo guardado.
  const [firmaVista, setFirmaVista] = useState(firmaGuardada);
  if (firmaVista !== firmaGuardada) {
    setFirmaVista(firmaGuardada);
    setNombre(nombreGuardado);
    setCorreos(guardados);
  }

  const [guardando, setGuardando] = useState(false);
  const [cambiandoActivo, setCambiandoActivo] = useState(false);
  const [probando, setProbando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<ResumenPruebaResultado | null>(null);

  const activo = canal?.activo ?? false;
  const sucio = JSON.stringify([nombre.trim(), correos.map((c) => c.trim())]) !== JSON.stringify([nombreGuardado, guardados]);
  const valido = nombre.trim().length > 0 && correos.every((c) => c.trim().length > 0);
  const puedeEncender = guardados.length > 0 && !sucio;

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    if (!valido) return;
    setGuardando(true);
    setError(null);
    setPrueba(null);
    try {
      const config = { nombreRemitente: nombre.trim(), correos: correos.map((c) => c.trim()) };
      if (canal) await updateNotificacionCanal(token, canal.id, { config });
      // El canal nace apagado: se enciende con el interruptor, cuando ya hay al menos una dirección guardada.
      else await createNotificacionCanal(token, { tipo: "CORREO", config, activo: false });
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el correo");
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

  async function handlePrueba() {
    setProbando(true);
    setError(null);
    setPrueba(null);
    try {
      setPrueba(await enviarResumenSemanalPrueba(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar el resumen de prueba");
    } finally {
      setProbando(false);
    }
  }

  return (
    <CanalCardShell emoji="✉️" iconBg="#FEF3C7" iconColor="#D97706" titulo="Correo (resumen semanal)" className="min-w-0">
      {activo ? <Badge variant="exito">Activo</Badge> : <Badge variant="neutro">{canal ? "Inactivo" : "Sin configurar"}</Badge>}

      <p className="text-sm text-admin-ink-soft">
        Cada lunes a las 10:00 (hora de Ciudad de México) mandamos a estas direcciones el resumen de los pedidos de la semana
        anterior, con su Excel adjunto.
      </p>

      <form onSubmit={handleGuardar} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-admin-ink-soft">
          Nombre del remitente
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={MAX_NOMBRE}
            placeholder="Nombre de tu negocio"
            className="admin-input w-full min-w-0 truncate font-normal"
          />
        </label>

        <div className="flex flex-col gap-2">
          {correos.length === 0 && <p className="text-xs text-admin-ink-soft">Aún no hay direcciones.</p>}
          {correos.map((c, i) => (
            <div key={i} className="flex min-w-0 items-center gap-2">
              <input
                type="email"
                value={c}
                onChange={(e) => setCorreos((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="correo@ejemplo.com"
                aria-label={`Dirección de correo ${i + 1}`}
                className="admin-input w-full min-w-0 flex-1 truncate"
              />
              <Button
                type="button"
                variant="secondary"
                size="barra"
                onClick={() => setCorreos((prev) => prev.filter((_, j) => j !== i))}
                aria-label={`Quitar la dirección ${i + 1}`}
                className="shrink-0"
              >
                Quitar
              </Button>
            </div>
          ))}
        </div>
        <p className="break-words text-xs text-admin-ink-soft">Máximo {MAX_CORREOS} direcciones.</p>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {prueba && (
          <Aviso tono={prueba.resultado === "EXITO" ? "neutro" : "ambar"}>
            {prueba.resultado === "EXITO"
              ? `Resumen de prueba enviado a ${prueba.destinatarios} ${prueba.destinatarios === 1 ? "dirección" : "direcciones"} (semana del ${prueba.semanaInicio} al ${prueba.semanaFin}${prueba.conPedidos ? "" : ", sin pedidos"}).`
              : `No se pudo enviar el resumen de prueba${prueba.motivo ? `: ${prueba.motivo}` : "."}`}
          </Aviso>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="barra"
            disabled={correos.length >= MAX_CORREOS}
            onClick={() => setCorreos((prev) => [...prev, ""])}
          >
            Agregar dirección
          </Button>
          <Button type="submit" size="barra" disabled={guardando || !sucio || !valido}>
            {guardando ? "Guardando..." : "Guardar"}
          </Button>
          {canal && (
            <label className="ml-auto flex items-center gap-2 text-sm font-semibold text-admin-ink">
              {activo ? "Activo" : "Inactivo"}
              <ToggleSwitch
                checked={activo}
                onChange={() => {
                  // Encender exige al menos una dirección guardada; apagar nunca se bloquea.
                  if (cambiandoActivo || (!activo && !puedeEncender)) return;
                  void handleActivo();
                }}
                label={activo ? "Desactivar el resumen semanal por correo" : "Activar el resumen semanal por correo"}
              />
            </label>
          )}
        </div>
        {canal && !activo && !puedeEncender && (
          <p className="text-xs text-admin-ink-soft">Guarda al menos una dirección para poder activar el canal.</p>
        )}

        <div className="flex flex-col gap-1 border-t border-admin-border pt-3">
          <Button type="button" variant="secondary" size="barra" disabled={probando || !canal || guardados.length === 0 || sucio} onClick={() => void handlePrueba()}>
            {probando ? "Enviando..." : "Enviar resumen de prueba"}
          </Button>
          <p className="text-xs text-admin-ink-soft">
            Manda ahora el resumen de la semana anterior a las direcciones guardadas. No cuenta como el envío del lunes.
          </p>
        </div>
      </form>
    </CanalCardShell>
  );
}
