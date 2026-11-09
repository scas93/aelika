"use client";

import { useState } from "react";
import {
  ApiError,
  createNotificacionCanal,
  enviarResumenSemanalPrueba,
  updateNotificacionCanal,
  type NotificacionCanalConfig,
  type NotificacionEventoConfig,
  type ResumenPruebaResultado,
} from "@/lib/api";
import { ultimasSemanas } from "@/lib/semanas-resumen";
import Aviso from "../../_components/Aviso";
import Button from "../../_components/Button";
import AvisoCard, { Plegable } from "./aviso-card";
import { apagarAviso, avisoEncendido, encenderAviso } from "./aviso-activacion";

const MAX_CORREOS = 10;
const MAX_NOMBRE = 60;

function correosGuardados(canal: NotificacionCanalConfig | null): string[] {
  const lista = canal?.config.correos;
  return Array.isArray(lista) ? lista.filter((c): c is string => typeof c === "string") : [];
}

/**
 * «Resumen semanal del negocio»: cada lunes por correo, a una lista de direcciones (de 1 a 10), con su Excel. Por dentro es el
 * canal Correo + el evento RESUMEN_SEMANAL para el negocio; aquí es un solo interruptor con sus direcciones y el nombre del
 * remitente. La prueba envía el resumen de la semana elegida solo con lo guardado.
 */
export default function AvisoResumenNegocioCard({
  token,
  canal,
  evento,
  onChange,
}: {
  token: string;
  canal: NotificacionCanalConfig | null;
  evento: NotificacionEventoConfig | null;
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
  const [cambiando, setCambiando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<ResumenPruebaResultado | null>(null);
  const semanas = ultimasSemanas();
  const [semanaPrueba, setSemanaPrueba] = useState(semanas[0].inicio);

  const encendido = avisoEncendido(canal, evento);
  const sucio = JSON.stringify([nombre.trim(), correos.map((c) => c.trim())]) !== firmaGuardada;
  const valido = nombre.trim().length > 0 && correos.every((c) => c.trim().length > 0);

  const faltan: string[] = [];
  if (guardados.length === 0) faltan.push("Agrega al menos una dirección para poder encenderlo.");
  else if (sucio) faltan.push("Guarda los cambios para poder encenderlo.");

  const destino =
    guardados.length === 0 ? "Nadie todavía" : `${guardados.length} ${guardados.length === 1 ? "dirección" : "direcciones"}: ${guardados.join(", ")}`;

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

  async function handleInterruptor() {
    if (cambiando) return;
    setCambiando(true);
    setError(null);
    try {
      if (encendido) await apagarAviso(token, canal, evento);
      else if (canal) await encenderAviso(token, canal, evento, { evento: "RESUMEN_SEMANAL", audiencia: "NEGOCIO" });
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el aviso");
    } finally {
      setCambiando(false);
    }
  }

  async function handlePrueba() {
    setProbando(true);
    setError(null);
    setPrueba(null);
    try {
      setPrueba(await enviarResumenSemanalPrueba(token, semanaPrueba));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar el resumen de prueba");
    } finally {
      setProbando(false);
    }
  }

  return (
    <AvisoCard
      titulo="Resumen semanal del negocio"
      descripcion="Cada lunes a las 10:00 (hora de Ciudad de México), por correo, los pedidos de la semana anterior con su Excel adjunto."
      encendido={encendido}
      destino={destino}
      faltan={faltan}
      ocupado={cambiando || !canal}
      onInterruptor={() => void handleInterruptor()}
    >
      <form onSubmit={handleGuardar} className="flex flex-col gap-3 border-t border-admin-border pt-3">
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
            {guardando ? "Guardando..." : "Guardar direcciones"}
          </Button>
        </div>
      </form>

      <Plegable titulo="Probar">
        {prueba && (
          <Aviso tono={prueba.resultado === "EXITO" ? "neutro" : "ambar"}>
            {prueba.resultado === "EXITO"
              ? `Resumen de prueba enviado a ${prueba.destinatarios} ${prueba.destinatarios === 1 ? "dirección" : "direcciones"} (semana del ${prueba.semanaInicio} al ${prueba.semanaFin}${prueba.conPedidos ? "" : ", sin pedidos"}).`
              : `No se pudo enviar el resumen de prueba${prueba.motivo ? `: ${prueba.motivo}` : "."}`}
          </Aviso>
        )}
        <label className="flex flex-col gap-1 text-xs font-semibold text-admin-ink-soft">
          Semana de la prueba
          <select value={semanaPrueba} onChange={(e) => setSemanaPrueba(e.target.value)} className="admin-input w-full font-normal">
            {semanas.map((w) => (
              <option key={w.inicio} value={w.inicio}>
                {w.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <div>
          <Button type="button" variant="secondary" size="barra" disabled={probando || !canal || guardados.length === 0 || sucio} onClick={() => void handlePrueba()}>
            {probando ? "Enviando..." : "Enviar resumen de prueba"}
          </Button>
        </div>
        <p className="text-xs text-admin-ink-soft">
          Manda ahora el resumen de la semana elegida a las direcciones guardadas. No cuenta como el envío del lunes.
        </p>
      </Plegable>
    </AvisoCard>
  );
}
