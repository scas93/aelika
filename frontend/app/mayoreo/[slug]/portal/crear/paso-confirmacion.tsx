"use client";

import { useEffect } from "react";
import type { ResultadoPedidoPortal } from "@/lib/portal-api";
import { etiquetaFechaCorta, hora12 } from "@/lib/portal-calendario-formato";
import { BTN_PRIMARIO, CARD, dinero } from "../estilos";
import BotonWhatsApp from "../boton-whatsapp";
import BarraAccionFija from "./barra-accion-fija";
import { BloqueRecoge } from "./bloques-pedido";

// Paso 5: confirmación. Responde «¿cuándo y dónde recojo?»: una fila por día del pedido con su hora, y la dirección del
// negocio. El detalle de productos y precios vive en «Ver mis pedidos».
export default function PasoConfirmacion({
  resultado,
  cliente,
  numeroAtencion,
  horaEntrega,
  ubicacion,
  onVolver,
}: {
  resultado: ResultadoPedidoPortal;
  /** Nombre del cliente de la sesión (mensaje precargado de WhatsApp). */
  cliente: string;
  numeroAtencion: string | null;
  /** Hora de recolección del negocio, "HH:mm". */
  horaEntrega: string;
  /** Dirección del negocio; null/vacía = no se muestra «Recoge en». */
  ubicacion: string | null;
  onVolver: () => void;
}) {
  const varios = resultado.pedidos.length > 1;
  // Todas las fechas juntas (también si son dos semanas), en orden cronológico.
  const dias = resultado.pedidos
    .flatMap((p) =>
      p.entregas.map((e) => ({
        fecha: e.fecha,
        piezas: e.productos.reduce((s, x) => s + x.cantidad, 0),
      })),
    )
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const folios = resultado.pedidos.map((p) => p.folio).join(", ");
  const direccion = ubicacion?.trim() || null;

  // La confirmación aparece al final de un flujo largo: siempre se abre arriba, también en el celular (donde el
  // navegador conserva el desplazamiento de la pantalla anterior).
  useEffect(() => {
    subirAlInicio();
    const id = requestAnimationFrame(subirAlInicio);
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 text-green-700"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <h2 className="text-lg font-bold">
          {varios
            ? "¡Tus pedidos quedaron registrados!"
            : "¡Tu pedido quedó registrado!"}
        </h2>
        <span className="self-start rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
          Por confirmar
        </span>
        <p className="text-sm text-mayoreo-ink-soft">
          Te avisaremos por WhatsApp cuando el negocio lo confirme
        </p>
      </div>

      <section className={CARD + " gap-3"}>
        <h3 className="text-sm font-semibold">Tus recolecciones</h3>
        <ul className="flex flex-col">
          {dias.map((d) => (
            <li
              key={d.fecha}
              className="flex flex-col gap-0.5 border-t border-mayoreo-border py-3 first:border-t-0 first:pt-0 last:pb-0"
            >
              <span className="text-base font-bold">
                {etiquetaFechaCorta(d.fecha)} · {hora12(horaEntrega)}
              </span>
              <span className="text-sm text-mayoreo-ink-soft">
                {d.piezas} pzas
              </span>
            </li>
          ))}
        </ul>
        <BloqueRecoge
          direccion={direccion}
          className="border-t border-mayoreo-border pt-3"
        />
      </section>

      <p className="text-xs text-mayoreo-ink-soft">
        Total {dinero(resultado.total)} · {varios ? "Folios" : "Folio"} {folios}
      </p>

      <BarraAccionFija>
        <div className="flex flex-col gap-2">
          <button className={BTN_PRIMARIO} onClick={onVolver}>
            Volver al menú
          </button>
          {numeroAtencion && (
            <BotonWhatsApp
              secundario
              numeroAtencion={numeroAtencion}
              contexto={{
                tipo: "pedido",
                cliente,
                folios: resultado.pedidos.map((p) => p.folio),
              }}
            />
          )}
        </div>
      </BarraAccionFija>
    </div>
  );
}

/** Lleva la página al inicio (window y los contenedores de desplazamiento que usan algunos navegadores móviles). */
export function subirAlInicio() {
  window.scrollTo(0, 0);
  const el = document.scrollingElement;
  if (el) el.scrollTop = 0;
  document.body.scrollTop = 0;
}
