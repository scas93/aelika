"use client";

import { useEffect } from "react";
import type { ResultadoPedidoPortal } from "@/lib/portal-api";
import { etiquetaFecha } from "@/lib/portal-calendario-formato";
import { rangoSemanaTexto } from "@/lib/pedido-b2b-fechas";
import { BTN_PRIMARIO, CARD, dinero } from "../estilos";
import BotonWhatsApp from "../boton-whatsapp";

// Paso 5: confirmación con el o los folios y el resumen (datos que devuelve el servidor, no los calculados aquí).
export default function PasoConfirmacion({
  resultado,
  cliente,
  numeroAtencion,
  onVolver,
}: {
  resultado: ResultadoPedidoPortal;
  /** Nombre del cliente de la sesión (mensaje precargado de WhatsApp). */
  cliente: string;
  numeroAtencion: string | null;
  onVolver: () => void;
}) {
  const varios = resultado.pedidos.length > 1;

  // La confirmación aparece al final de un flujo largo: siempre se abre arriba, también en el celular (donde el
  // navegador conserva el desplazamiento de la pantalla anterior).
  useEffect(() => {
    subirAlInicio();
    const id = requestAnimationFrame(subirAlInicio);
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <h2 className="text-lg font-bold">
          {varios
            ? "¡Tus pedidos quedaron registrados!"
            : "¡Tu pedido quedó registrado!"}
        </h2>
        <p className="text-sm text-mayoreo-ink-soft">
          Está <strong>por confirmar</strong>: el negocio lo revisará y te
          avisará por WhatsApp cuando lo confirme.
        </p>
        <ul className="flex flex-col gap-1">
          {resultado.pedidos.map((p) => (
            <li key={p.folio} className="text-base font-semibold">
              Folio {p.folio}
            </li>
          ))}
        </ul>
      </div>

      {resultado.pedidos.map((p) => (
        <section key={p.folio} className={CARD + " gap-3"}>
          <div>
            <h3 className="text-sm font-semibold">
              {p.folio} · Semana del{" "}
              {rangoSemanaTexto(p.semanaInicio, p.semanaFin)}
            </h3>
          </div>
          {p.entregas.map((e) => (
            <div key={e.fecha} className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                {etiquetaFecha(e.fecha)}
              </span>
              {e.productos.map((x) => (
                <span
                  key={x.nombre}
                  className="flex justify-between text-sm text-mayoreo-ink-soft"
                >
                  <span>
                    {x.cantidad} × {x.nombre}
                  </span>
                  <span>{dinero(x.subtotal)}</span>
                </span>
              ))}
            </div>
          ))}
          <div className="flex flex-col gap-0.5 border-t border-mayoreo-border pt-2 text-sm">
            <span className="flex justify-between">
              <span>Subtotal ({p.totalPiezas} piezas)</span>
              <span>{dinero(p.subtotal)}</span>
            </span>
            {p.descuentoTotal > 0 && (
              <span className="flex justify-between text-mayoreo-ink-soft">
                <span>Descuento {p.descuentoPorcentaje}%</span>
                <span>−{dinero(p.descuentoTotal)}</span>
              </span>
            )}
            <span className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{dinero(p.total)}</span>
            </span>
          </div>
        </section>
      ))}

      {varios && (
        <p className="text-center text-sm font-semibold">
          Total de los dos pedidos: {dinero(resultado.total)}
        </p>
      )}
      {numeroAtencion && (
        <div className={CARD + " gap-2"}>
          <p className="text-sm text-mayoreo-ink-soft">
            ¿Dudas con tu pedido? Escríbenos.
          </p>
          <BotonWhatsApp
            numeroAtencion={numeroAtencion}
            contexto={{
              tipo: "pedido",
              cliente,
              folios: resultado.pedidos.map((p) => p.folio),
            }}
          />
        </div>
      )}
      <button className={BTN_PRIMARIO} onClick={onVolver}>
        Volver al menú
      </button>
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
