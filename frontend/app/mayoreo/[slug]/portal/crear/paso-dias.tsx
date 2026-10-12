"use client";

import type { CalendarioPortal, FavoritoPortal } from "@/lib/portal-api";
import {
  ETIQUETA_MOTIVO,
  enlaceContacto,
  etiquetaFecha,
  textoLimite,
} from "@/lib/portal-calendario-formato";
import { rangoSemanaTexto } from "@/lib/pedido-b2b-fechas";
import { AVISO, BTN_PRIMARIO, BTN_SECUNDARIO, CARD } from "../estilos";

const MENSAJE_YA_TIENE_PEDIDO =
  "Ya tienes pedido para esta semana. Para agregar o cambiar entregas, usa Modificar pedido activo";

interface Props {
  calendario: CalendarioPortal;
  fechas: string[];
  favorito: FavoritoPortal | null;
  onToggle: (fecha: string) => void;
  onUsarFavorito: () => void;
  onContinuar: () => void;
}

// Paso 1: elegir los días de entrega. Solo se pueden elegir los días `AGREGABLE` de semanas sin pedido (el servidor decide).
export default function PasoDias({
  calendario,
  fechas,
  favorito,
  onToggle,
  onUsarFavorito,
  onContinuar,
}: Props) {
  const contacto = enlaceContacto(calendario.numeroAtencion);
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
            <div className="flex flex-col gap-2">
              <p className={AVISO}>
                {MENSAJE_YA_TIENE_PEDIDO} (pedido {semana.pedido.folio}).
              </p>
              {contacto && (
                <a
                  className="text-sm font-medium underline"
                  href={contacto}
                  target="_blank"
                  rel="noreferrer"
                >
                  Contactar al negocio
                </a>
              )}
            </div>
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
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

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
