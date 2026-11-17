"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ApiError,
  createNotificacionCanal,
  createNotificacionEvento,
  enviarEntregaConfirmadaPrueba,
  fetchClientesB2bSelector,
  updateNotificacionEvento,
  type ClienteB2bSelectorItem,
  type EntregaConfirmadaPruebaResultado,
  type NotificacionCanalConfig,
  type NotificacionEventoConfig,
} from "@/lib/api";
import Aviso from "../../_components/Aviso";
import Button from "../../_components/Button";
import AvisoCard, { Plegable } from "./aviso-card";

/**
 * «Entrega confirmada»: interruptor general del negocio (apagado por defecto) del correo que recibe cada cliente B2B cuando una de
 * sus entregas se marca como Entregada. Cada cliente se activa en su ficha (interruptor propio, independiente del resumen semanal)
 * y se le escribe al mismo correo. Por dentro es el evento ENTREGA_CONFIRMADA con audiencia CLIENTE; necesita un canal Correo, que
 * se crea inactivo si no existía (no activa el resumen del negocio). El envío NO depende de que ese canal esté activo.
 */
export default function AvisoEntregaConfirmadaCard({
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
  const evento = eventos?.find((e) => e.evento === "ENTREGA_CONFIRMADA" && e.audiencia === "CLIENTE") ?? null;
  const encendido = evento?.activo ?? false;

  const [cambiando, setCambiando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clientes, setClientes] = useState<ClienteB2bSelectorItem[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [destino, setDestino] = useState("");
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<EntregaConfirmadaPruebaResultado | null>(null);
  const [errorPrueba, setErrorPrueba] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetchClientesB2bSelector(token)
      .then((lista) => !cancelado && setClientes(lista))
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [token]);

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
        const nuevo = await createNotificacionEvento(token, { evento: "ENTREGA_CONFIRMADA", audiencia: "CLIENTE", canalConfigId: canal.id });
        await updateNotificacionEvento(token, nuevo.id, { activo: true });
      }
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el aviso");
    } finally {
      setCambiando(false);
    }
  }

  async function handlePrueba() {
    setProbando(true);
    setErrorPrueba(null);
    setPrueba(null);
    try {
      setPrueba(await enviarEntregaConfirmadaPrueba(token, { clienteId, correo: destino.trim() }));
    } catch (err) {
      setErrorPrueba(err instanceof ApiError ? err.message : "No se pudo enviar la prueba");
    } finally {
      setProbando(false);
    }
  }

  return (
    <AvisoCard
      titulo="Entrega confirmada"
      descripcion="Cada vez que una entrega se marca como Entregada, el cliente con el aviso activado recibe por correo lo que se le entregó, con sus productos, unidades, precios y el total de esa entrega. Sin información de pago."
      encendido={encendido}
      destino="Cada cliente con el aviso activado, a su propio correo"
      faltan={[]}
      ocupado={cambiando}
      onInterruptor={() => void handleInterruptor()}
    >
      <p className="text-xs text-admin-ink-soft">
        Se activa cliente por cliente en su ficha y usa el mismo correo del resumen semanal. Se envía solo la primera vez que una entrega pasa a
        Entregada, y el correo de respuestas es el que configuras en «Resumen semanal para clientes».
      </p>
      <div className="text-sm">
        <Link href="/dashboard/clientes" className="font-semibold text-admin-accent-dark underline-offset-2 hover:underline">
          Ver clientes
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Plegable titulo="Probar la entrega confirmada con un cliente">
        <p className="text-xs text-admin-ink-soft">
          Manda el correo de la entrega entregada más reciente de un cliente a la dirección que escribas, no al cliente. Funciona aunque los
          interruptores estén apagados.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-admin-ink-soft">
            Cliente de la prueba
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
            Enviar la prueba a
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
              ? `Prueba enviada a ${destino.trim()} (entrega del ${prueba.fechaEntrega}).`
              : `No se pudo enviar la prueba${prueba.motivo ? `: ${prueba.motivo}` : "."}`}
          </Aviso>
        )}
        <div>
          <Button type="button" variant="secondary" size="barra" disabled={probando || !clienteId || destino.trim() === ""} onClick={() => void handlePrueba()}>
            {probando ? "Enviando..." : "Enviar prueba de la entrega"}
          </Button>
        </div>
      </Plegable>
    </AvisoCard>
  );
}
