"use client";

import type {
  CalendarioPortal,
  SemanaCalendarioPortal,
} from "@/lib/portal-api";
import {
  ETIQUETA_MOTIVO,
  textoSinEntrega,
  etiquetaFecha,
  rangoSemanaCorto,
  textoLimite,
} from "@/lib/portal-calendario-formato";
import { diasCerrados } from "@/lib/portal-pedido-modelo";
import { BTN_PRIMARIO, CARD } from "../estilos";
import BotonWhatsApp from "../boton-whatsapp";
import BarraAccionFija from "./barra-accion-fija";

interface Props {
  /** Nombre del cliente de la sesión (va en el mensaje precargado de WhatsApp). */
  cliente: string;
  calendario: CalendarioPortal;
  /** Semana elegida en el paso anterior: solo se muestran sus días. */
  semana: SemanaCalendarioPortal;
  fechas: string[];
  onToggle: (fecha: string) => void;
  onContinuar: () => void;
}

// Paso 2: elegir los días de entrega de la semana elegida. Solo se pueden elegir los días `AGREGABLE` (el servidor decide).
export default function PasoDias({
  cliente,
  calendario,
  semana,
  fechas,
  onToggle,
  onContinuar,
}: Props) {
  // Contacto con el negocio (solo si hay número de atención). Un solo día cerrado → botón junto a ese día con su mensaje;
  // varios días cerrados → UN solo botón con el mensaje genérico, para no repetirlo.
  const cerrados = diasCerrados({ ...calendario, semanas: [semana] });
  const diaUnico = cerrados.length === 1 ? cerrados[0] : null;
  const hayContactoGeneral =
    calendario.numeroAtencion !== null && cerrados.length > 1;
  const rango = rangoSemanaCorto(semana.semanaInicio, semana.semanaFin);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-mayoreo-ink-soft">
          Las entregas son a las {calendario.horaEntrega}. Pide con al menos{" "}
          {calendario.horasAgregar} horas de anticipación.
        </p>
      </div>

      <section className={CARD + " gap-2"}>
        <h3 className="text-sm font-semibold">
          Semana {rango}
          {semana.esActual ? " (en curso)" : ""}
        </h3>
        <ul className="flex flex-col divide-y divide-mayoreo-border">
          {semana.dias.map((d) => {
            const elegible =
              d.estado === "AGREGABLE" && d.accion === "CREAR_PEDIDO";
            const elegido = fechas.includes(d.fecha);
            // Los días disponibles solo llevan la fecha; los no elegibles conservan su motivo.
            const limite = elegible ? null : textoLimite(d);
            return (
              <li key={d.fecha}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={elegido}
                  disabled={!elegible}
                  onClick={() => onToggle(d.fecha)}
                  className={`-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left transition ${
                    elegible ? "" : "cursor-not-allowed opacity-50"
                  } ${elegido ? "bg-mayoreo-accent-soft" : ""}`}
                >
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">
                      {etiquetaFecha(d.fecha)}
                    </span>
                    {!elegible && (
                      <span className="text-xs text-mayoreo-ink-soft">
                        {d.motivo === "SIN_ENTREGA"
                          ? textoSinEntrega(d.sinEntrega?.nota)
                          : d.motivo === "ANTICIPACION_AGREGAR"
                          ? "Ya no hay tiempo para hacer pedido"
                          : [
                              d.motivo ? ETIQUETA_MOTIVO[d.motivo] : null,
                              limite,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                      </span>
                    )}
                  </span>
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-sm ${
                      elegido
                        ? "border-mayoreo-button bg-mayoreo-button text-white"
                        : "border-mayoreo-ink-soft bg-mayoreo-card text-transparent"
                    }`}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                </button>
                {diaUnico?.fecha === d.fecha && (
                  <div className="pb-2.5">
                    <BotonWhatsApp
                      compacto
                      numeroAtencion={calendario.numeroAtencion}
                      contexto={{ tipo: "dia", cliente, fecha: d.fecha }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {hayContactoGeneral && (
        <div className={CARD + " gap-2"}>
          <p className="text-sm text-mayoreo-ink-soft">
            ¿Necesitas pedir o cambiar una entrega que ya no se puede elegir
            aquí? Escríbenos.
          </p>
          <BotonWhatsApp
            numeroAtencion={calendario.numeroAtencion}
            contexto={{ tipo: "general", cliente }}
          />
        </div>
      )}

      <BarraAccionFija>
        <button
          className={BTN_PRIMARIO}
          disabled={fechas.length === 0}
          onClick={onContinuar}
        >
          Continuar
          {fechas.length > 0
            ? ` · ${fechas.length} ${fechas.length === 1 ? "día" : "días"}`
            : ""}
        </button>
      </BarraAccionFija>
    </div>
  );
}
