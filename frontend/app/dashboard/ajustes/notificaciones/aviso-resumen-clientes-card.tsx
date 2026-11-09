"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createNotificacionCanal,
  createNotificacionEvento,
  enviarResumenClientePrueba,
  fetchClientesB2bSelector,
  fetchResumenClientesConfig,
  guardarResumenClientesConfig,
  updateNotificacionEvento,
  type ClienteB2bSelectorItem,
  type NotificacionCanalConfig,
  type NotificacionEventoConfig,
  type ResumenClientePruebaResultado,
} from "@/lib/api";
import { ultimasSemanas } from "@/lib/semanas-resumen";
import Aviso from "../../_components/Aviso";
import Button from "../../_components/Button";
import AvisoCard, { Plegable } from "./aviso-card";

/**
 * «Resumen semanal para clientes»: interruptor general del negocio (apagado por defecto), contador de clientes con el envío
 * activado (cada cliente se activa en su ficha), correo de respuestas y prueba con un cliente. Por dentro es el evento
 * RESUMEN_SEMANAL con audiencia CLIENTE; necesita un canal Correo, que se crea inactivo si no existía (no activa el resumen del
 * negocio: ese sigue en su propia tarjeta). El envío a clientes NO depende de que el canal Correo esté activo.
 */
export default function AvisoResumenClientesCard({
  token,
  nombreNegocio,
  canales,
  eventos,
  onChange,
}: {
  token: string;
  nombreNegocio: string;
  canales: NotificacionCanalConfig[] | null;
  eventos: NotificacionEventoConfig[] | null;
  onChange: () => Promise<void>;
}) {
  const evento = eventos?.find((e) => e.evento === "RESUMEN_SEMANAL" && e.audiencia === "CLIENTE") ?? null;
  const encendido = evento?.activo ?? false;

  const [guardado, setGuardado] = useState<string | null>(null);
  const [correoRespuestas, setCorreoRespuestas] = useState("");
  const [clientesConEnvio, setClientesConEnvio] = useState<number | null>(null);
  const [cargado, setCargado] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clientes, setClientes] = useState<ClienteB2bSelectorItem[]>([]);
  const semanas = ultimasSemanas();
  const [clienteId, setClienteId] = useState("");
  const [semana, setSemana] = useState(semanas[0].inicio);
  const [destino, setDestino] = useState("");
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<ResumenClientePruebaResultado | null>(null);
  const [errorPrueba, setErrorPrueba] = useState<string | null>(null);

  // El contador se vuelve a leer al regresar a la pestaña (los clientes se activan en otra pantalla).
  const cargarContador = useCallback(async () => {
    try {
      const c = await fetchResumenClientesConfig(token);
      setClientesConEnvio(typeof c.clientesConEnvio === "number" ? c.clientesConEnvio : null);
    } catch {
      /* el contador es informativo */
    }
  }, [token]);

  useEffect(() => {
    let cancelado = false;
    fetchResumenClientesConfig(token)
      .then((c) => {
        if (cancelado) return;
        setGuardado(c.correoRespuestas);
        setCorreoRespuestas(c.correoRespuestas ?? "");
        setClientesConEnvio(typeof c.clientesConEnvio === "number" ? c.clientesConEnvio : null);
        setCargado(true);
      })
      .catch((err) => !cancelado && setError(err instanceof ApiError ? err.message : "No se pudo cargar la configuración"));
    fetchClientesB2bSelector(token)
      .then((lista) => !cancelado && setClientes(lista))
      .catch(() => {});
    const alVolver = () => {
      if (document.visibilityState === "visible") void cargarContador();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [token, cargarContador]);

  async function handleInterruptor() {
    if (cambiando) return;
    setCambiando(true);
    setError(null);
    try {
      if (evento) {
        await updateNotificacionEvento(token, evento.id, { activo: !evento.activo });
      } else {
        // Primera vez: hace falta un canal Correo (se crea INACTIVO, sin direcciones) y la fila del evento, que nace apagada.
        let canal = canales?.find((c) => c.tipo === "CORREO") ?? null;
        if (!canal) {
          canal = await createNotificacionCanal(token, {
            tipo: "CORREO",
            config: { nombreRemitente: nombreNegocio.slice(0, 60) || "Mi negocio", correos: [] },
            activo: false,
          });
        }
        const nuevo = await createNotificacionEvento(token, { evento: "RESUMEN_SEMANAL", audiencia: "CLIENTE", canalConfigId: canal.id });
        await updateNotificacionEvento(token, nuevo.id, { activo: true });
      }
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el aviso");
    } finally {
      setCambiando(false);
    }
  }

  async function handleGuardarCorreo(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const r = await guardarResumenClientesConfig(token, correoRespuestas.trim() || null);
      setGuardado(r.correoRespuestas);
      setCorreoRespuestas(r.correoRespuestas ?? "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el correo de respuestas");
    } finally {
      setGuardando(false);
    }
  }

  async function handlePrueba() {
    setProbando(true);
    setErrorPrueba(null);
    setPrueba(null);
    try {
      setPrueba(await enviarResumenClientePrueba(token, { clienteId, correo: destino.trim(), semanaInicio: semana }));
    } catch (err) {
      setErrorPrueba(err instanceof ApiError ? err.message : "No se pudo enviar la prueba");
    } finally {
      setProbando(false);
    }
  }

  const sucio = (guardado ?? "") !== correoRespuestas.trim();
  const destinoTexto =
    clientesConEnvio === null
      ? "Cada cliente con el envío activado, a su propio correo"
      : clientesConEnvio === 0
        ? "Ningún cliente todavía: se activa en la ficha de cada cliente"
        : `${clientesConEnvio} ${clientesConEnvio === 1 ? "cliente" : "clientes"}, a su propio correo`;

  return (
    <AvisoCard
      titulo="Resumen semanal para clientes"
      descripcion="Cada lunes a las 10:00 (hora de Ciudad de México), cada cliente con el envío activado recibe por correo sus pedidos y entregas de la semana anterior, con su Excel. Sin información de pago."
      encendido={encendido}
      destino={destinoTexto}
      faltan={[]}
      ocupado={cambiando}
      onInterruptor={() => void handleInterruptor()}
    >
      <p className="text-xs text-admin-ink-soft">Si lo enciendes después de las 10:00 del lunes, el primer envío es el lunes siguiente.</p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-admin-ink">
          Clientes con envío activado: {clientesConEnvio === null ? "—" : clientesConEnvio}
        </span>
        <Link href="/dashboard/clientes" className="font-semibold text-admin-accent-dark underline-offset-2 hover:underline">
          Ver clientes
        </Link>
      </div>

      <form onSubmit={handleGuardarCorreo} className="flex flex-col gap-2 border-t border-admin-border pt-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-admin-ink-soft">
          Correo de respuestas (opcional)
          <input
            type="email"
            value={correoRespuestas}
            onChange={(e) => setCorreoRespuestas(e.target.value)}
            placeholder="ventas@tunegocio.com"
            disabled={!cargado}
            className="admin-input w-full min-w-0 font-normal"
          />
        </label>
        <p className="text-xs text-admin-ink-soft">
          Cuando un cliente responda el correo, su respuesta llegará aquí. El correo se muestra enviado por «{nombreNegocio}»; si lo
          dejas vacío, no se podrá responder.
        </p>
        <div>
          <Button type="submit" size="barra" disabled={guardando || !sucio}>
            {guardando ? "Guardando..." : "Guardar correo de respuestas"}
          </Button>
        </div>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Plegable titulo="Probar con un cliente">
        <p className="text-xs text-admin-ink-soft">
          Manda el resumen de un cliente (el mismo correo y Excel que recibiría) a la dirección que escribas, no al cliente. No cuenta
          como el envío del lunes.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-admin-ink-soft">
            Cliente
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="admin-input w-full font-normal">
              <option value="">Elige un cliente</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-admin-ink-soft">
            Semana
            <select value={semana} onChange={(e) => setSemana(e.target.value)} className="admin-input w-full font-normal">
              {semanas.map((w) => (
                <option key={w.inicio} value={w.inicio}>
                  {w.etiqueta}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-admin-ink-soft">
            Enviar a
            <input
              type="email"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              placeholder="tu@correo.com"
              className="admin-input w-full min-w-0 font-normal"
            />
          </label>
        </div>
        {errorPrueba && <p className="text-sm text-red-600">{errorPrueba}</p>}
        {prueba && (
          <Aviso tono={prueba.resultado === "EXITO" ? "neutro" : "ambar"}>
            {prueba.resultado === "EXITO"
              ? `Prueba enviada a ${destino.trim()} (semana del ${prueba.semanaInicio} al ${prueba.semanaFin}).`
              : `No se pudo enviar la prueba${prueba.motivo ? `: ${prueba.motivo}` : "."}`}
          </Aviso>
        )}
        <div>
          <Button type="button" variant="secondary" size="barra" disabled={probando || !clienteId || destino.trim() === ""} onClick={() => void handlePrueba()}>
            {probando ? "Enviando..." : "Enviar prueba del cliente"}
          </Button>
        </div>
      </Plegable>
    </AvisoCard>
  );
}
