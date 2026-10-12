"use client";

import type { CalendarioPortal, FavoritoPortal } from "@/lib/portal-api";
import {
  ETIQUETA_MOTIVO,
  etiquetaFecha,
  textoLimite,
} from "@/lib/portal-calendario-formato";
import { diasCerrados } from "@/lib/portal-pedido-modelo";
import { rangoSemanaTexto } from "@/lib/pedido-b2b-fechas";
import { AVISO, BTN_PRIMARIO, BTN_SECUNDARIO, CARD } from "../estilos";
import BotonWhatsApp from "../boton-whatsapp";

const MENSAJE_YA_TIENE_PEDIDO =
  "Ya tienes pedido para esta semana. Para agregar o cambiar entregas, usa Modificar pedido activo";

interface Props {
  /** Nombre del cliente de la sesión (va en el mensaje precargado de WhatsApp). */
  cliente: string;
  calendario: CalendarioPortal;
  fechas: string[];
  favorito: FavoritoPortal | null;
  onToggle: (fecha: string) => void;
  onUsarFavorito: () => void;
  onContinuar: () => void;
}

// Paso 1: elegir los días de entrega. Solo se pueden elegir los días `AGREGABLE` de semanas sin pedido (el servidor decide).
export default function PasoDias({
  cliente,
  calendario,
  fechas,
  favorito,
  onToggle,
  onUsarFavorito,
  onContinuar,
}: Props) {
  // Contacto con el negocio (solo si hay número de atención). Un solo día cerrado → botón junto a ese día con su mensaje;
  // varios días cerrados o una semana que ya tiene pedido → UN solo botón con el mensaje genérico, para no repetirlo.
  const cerrados = diasCerrados(calendario);
  const semanasConPedido = calendario.semanas.filter((s) => s.pedido);
  const diaUnico =
    cerrados.length === 1 && semanasConPedido.length === 0 ? cerrados[0] : null;
  const hayContactoGeneral =
    calendario.numeroAtencion !== null &&
    !diaUnico &&
    (cerrados.length > 0 || semanasConPedido.length > 0);
  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <div>
          <h2 className="text-lg font-bold">Elige tus días de entrega</h2>
          <p className="text-sm text-mayoreo-ink-soft">
            Las entregas son a las {calendario.horaEntrega}. Pide con al menos{" "}
            {calendario.horasAgregar} horas de anticipación.
          </p>
        </div>
        {favorito?.favorito && (
          <button className={BTN_SECUNDARIO} onClick={onUsarFavorito}>
            Usar mi favorito
          </button>
        )}
      </div>

      {calendario.semanas.map((semana) => (
        <section key={semana.semanaInicio} className={CARD + " gap-2"}>
          <h3 className="text-sm font-semibold">
            Semana del {rangoSemanaTexto(semana.semanaInicio, semana.semanaFin)}
            {semana.esActual ? " (en curso)" : ""}
          </h3>
          {semana.pedido ? (
            <p className={AVISO}>
              {MENSAJE_YA_TIENE_PEDIDO} (pedido {semana.pedido.folio}).
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-mayoreo-border">
              {semana.dias.map((d) => {
                const elegible =
                  d.estado === "AGREGABLE" && d.accion === "CREAR_PEDIDO";
                const elegido = fechas.includes(d.fecha);
                const limite = textoLimite(d);
                return (
                  <li key={d.fecha}>
                    <button
                      type="button"
                      disabled={!elegible}
                      aria-pressed={elegido}
                      onClick={() => onToggle(d.fecha)}
                      className={`flex w-full items-center justify-between gap-3 py-2.5 text-left ${
                        elegible ? "" : "cursor-not-allowed opacity-50"
                      }`}
                    >
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">
                          {etiquetaFecha(d.fecha)}
                        </span>
                        <span className="text-xs text-mayoreo-ink-soft">
                          {elegible
                            ? limite
                            : [
                                d.motivo ? ETIQUETA_MOTIVO[d.motivo] : null,
                                limite,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                      </span>
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm ${
                          elegido
                            ? "border-mayoreo-button bg-mayoreo-button text-white"
                            : "border-mayoreo-border text-transparent"
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
          )}
        </section>
      ))}

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

      <button
        className={BTN_PRIMARIO}
        disabled={fechas.length === 0}
        onClick={onContinuar}
      >
        Continuar
        {fechas.length > 0
          ? ` (${fechas.length} ${fechas.length === 1 ? "día" : "días"})`
          : ""}
      </button>
    </div>
  );
}
