"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import type { CalendarioPortal, FavoritoPortal } from "@/lib/portal-api";
import {
  ETIQUETA_MOTIVO,
  etiquetaFecha,
  rangoSemanaCorto,
  textoLimite,
  textoPideAntes,
} from "@/lib/portal-calendario-formato";
import { rutaBasePortal } from "@/lib/portal-pedidos-formato";
import {
  diasCerrados,
  primerPeriodoSinPedido,
} from "@/lib/portal-pedido-modelo";
import { BTN_PRIMARIO, BTN_SECUNDARIO, CARD } from "../estilos";
import BotonWhatsApp from "../boton-whatsapp";
import BarraAccionFija from "./barra-accion-fija";

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
  const pathname = usePathname() ?? "";
  const { slug } = useParams<{ slug: string }>() ?? { slug: "" };
  const base = rutaBasePortal(pathname, slug);
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
      <div className="flex flex-col gap-1">
        <p className="text-sm text-mayoreo-ink-soft">
          Las entregas son a las {calendario.horaEntrega}. Pide con al menos{" "}
          {calendario.horasAgregar} horas de anticipación.
        </p>
      </div>
      {favorito?.favorito && primerPeriodoSinPedido(calendario) && (
        <button className={BTN_SECUNDARIO} onClick={onUsarFavorito}>
          Usar mi favorito
        </button>
      )}

      {calendario.semanas.map((semana) => {
        const rango = rangoSemanaCorto(semana.semanaInicio, semana.semanaFin);
        const enCurso = semana.esActual ? " (en curso)" : "";
        if (semana.pedido) {
          // Mismo criterio que el servidor (semanaModificable): sin pagar y con algún día que se pueda modificar o agregar.
          const modificable =
            !semana.pedido.pagado &&
            semana.dias.some(
              (d) => d.estado === "MODIFICABLE" || d.estado === "AGREGABLE",
            );
          return (
            <section key={semana.semanaInicio} className={CARD + " gap-3"}>
              <h3 className="text-sm font-semibold">
                Semana {rango}
                {enCurso}
              </h3>
              <p className="flex items-start gap-2 text-sm">
                <span className="text-green-700" aria-hidden="true">
                  ✓
                </span>
                <span>Ya tienes un pedido para esta semana</span>
              </p>
              {modificable ? (
                <Link
                  href={`${base}/portal/pedidos/${encodeURIComponent(semana.pedido.folio)}/modificar?desde=dias`}
                  className={BTN_SECUNDARIO + " block text-center"}
                >
                  Modificar pedido
                </Link>
              ) : (
                <p className="text-sm text-mayoreo-ink-soft">
                  Este pedido ya no se puede modificar
                </p>
              )}
            </section>
          );
        }
        return (
          <section key={semana.semanaInicio} className={CARD + " gap-2"}>
            <h3 className="text-sm font-semibold">
              Semana {rango}
              {enCurso}
            </h3>
            <ul className="flex flex-col divide-y divide-mayoreo-border">
              {semana.dias.map((d) => {
                const elegible =
                  d.estado === "AGREGABLE" && d.accion === "CREAR_PEDIDO";
                const elegido = fechas.includes(d.fecha);
                const limite =
                  elegible && d.limiteAt
                    ? textoPideAntes(d.limiteAt)
                    : textoLimite(d);
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
                        <span className="text-xs text-mayoreo-ink-soft">
                          {elegible
                            ? limite
                            : d.motivo === "ANTICIPACION_AGREGAR"
                              ? "Ya no hay tiempo para hacer pedido"
                              : [
                                  d.motivo ? ETIQUETA_MOTIVO[d.motivo] : null,
                                  limite,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                        </span>
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
        );
      })}

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
