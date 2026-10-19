"use client";

import { useEffect, useRef } from "react";
import { rangoSemanaCorto } from "@/lib/portal-calendario-formato";
import type { ProblemaFechaPortal } from "@/lib/portal-api";
import type { EntregaPedidoPortal } from "@/lib/portal-api";
import type { TotalesSemana } from "@/lib/portal-pedido-modelo";
import { AVISO, BTN_PRIMARIO, CARD, ERROR, dinero } from "../estilos";
import BarraAccionFija from "./barra-accion-fija";
import { DiaEntrega, TarjetaTotal } from "./bloques-pedido";

interface Props {
  entregas: EntregaPedidoPortal[];
  nombres: Map<string, string>;
  /** Totales de la semana del pedido (un pedido = una semana). */
  semana: TotalesSemana;
  descuentoPorcentaje: number;
  minimoPiezas: number;
  nota: string;
  onNota: (n: string) => void;
  enviando: boolean;
  error: string | null;
  problemas: ProblemaFechaPortal[];
  /** Vuelve a capturar ese día conservando todo lo armado. */
  onEditarDia: (fecha: string) => void;
  onEnviar: () => void;
}

// Paso final: resumen. Total general arriba, una tarjeta por semana (un pedido por semana) con su avance contra el mínimo,
// lo que recibe cada día (editable), los totales de la semana por producto, nota opcional y envío. El detalle del mínimo vive en las tarjetas; la barra fija solo lleva el botón.
export default function PasoResumen({
  entregas,
  nombres,
  semana: t,
  descuentoPorcentaje,
  minimoPiezas,
  nota,
  onNota,
  enviando,
  error,
  problemas,
  onEditarDia,
  onEnviar,
}: Props) {
  const { total, subtotal, descuento } = t;
  const bajoMinimo = t.faltanPiezas > 0;
  const hayMinimo = minimoPiezas > 0;

  // Errores del servidor / calendario: recuadro arriba; la pantalla se desplaza hasta él cuando aparece.
  const avisoRef = useRef<HTMLDivElement>(null);
  const hayAviso = problemas.length > 0 || !!error;
  useEffect(() => {
    if (hayAviso)
      avisoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hayAviso, error, problemas]);

  return (
    <div className="flex flex-col gap-4">
      {hayAviso && (
        <div ref={avisoRef} className="flex scroll-mt-4 flex-col gap-1">
          {problemas.map((p) => (
            <p key={p.fecha} className={ERROR}>
              {p.mensaje}
            </p>
          ))}
          {problemas.length > 0 && (
            <p className={AVISO}>
              Actualizamos el calendario. Revisa tus días y vuelve a enviar.
            </p>
          )}
          {error && problemas.length === 0 && <p className={ERROR}>{error}</p>}
        </div>
      )}

      <TarjetaTotal
        total={total}
        subtotal={subtotal}
        descuento={descuento}
        descuentoPorcentaje={descuentoPorcentaje}
      />

      {(() => {
        const cumple = t.faltanPiezas === 0;
        const avance = hayMinimo
          ? Math.min(100, (t.piezas / minimoPiezas) * 100)
          : 0;
        return (
          <section className={CARD + " gap-3"}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">
                Semana {rangoSemanaCorto(t.semanaInicio, t.semanaFin)}
              </h3>
              {hayMinimo && (
                <span
                  className={`text-sm font-semibold ${cumple ? "text-green-700" : "text-amber-700"}`}
                >
                  {t.piezas} / {minimoPiezas} pzas
                </span>
              )}
            </div>
            {hayMinimo && (
              <>
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-mayoreo-border"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={minimoPiezas}
                  aria-valuenow={Math.min(t.piezas, minimoPiezas)}
                  aria-label="Piezas contra el mínimo"
                >
                  <div
                    className={`h-full rounded-full ${cumple ? "bg-green-600" : "bg-amber-500"}`}
                    style={{ width: `${avance}%` }}
                  />
                </div>
                {cumple ? (
                  <p className="text-sm font-medium text-green-700">
                    ✓ Mínimo cubierto
                  </p>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <span>Faltan {t.faltanPiezas} pzas para el mínimo</span>
                    <button
                      type="button"
                      className="shrink-0 font-semibold underline"
                      onClick={() => onEditarDia(t.fechas[0])}
                    >
                      Agregar
                    </button>
                  </div>
                )}
              </>
            )}
            <div className="flex flex-col gap-3">
              {entregas
                .filter((e) => t.fechas.includes(e.fecha))
                .map((e) => (
                  <DiaEntrega
                    key={e.fecha}
                    fecha={e.fecha}
                    onEditar={() => onEditarDia(e.fecha)}
                    lineas={e.items.map((it) => ({
                      clave: it.productId,
                      nombre: nombres.get(it.productId) ?? "Producto",
                      cantidad: it.cantidad,
                    }))}
                  />
                ))}
            </div>
            <div className="flex flex-col gap-2 border-t border-mayoreo-border pt-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold">Total de la semana</span>
                <span className="text-sm font-bold tabular-nums">
                  {t.piezas} pzas
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {[...t.productos]
                  .sort((a, b) =>
                    (nombres.get(a.productId) ?? "").localeCompare(
                      nombres.get(b.productId) ?? "",
                      "es",
                    ),
                  )
                  .map((p) => (
                    <li
                      key={p.productId}
                      className="flex items-baseline justify-between gap-3 text-sm text-mayoreo-ink-soft"
                    >
                      <span className="min-w-0">
                        {nombres.get(p.productId) ?? "Producto"}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {p.cantidad}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          </section>
        );
      })()}

      <div className="flex flex-col gap-2 border-t border-mayoreo-border pt-3">
        <label
          className="flex flex-col gap-1 text-sm font-medium"
          htmlFor="nota"
        >
          Nota para el negocio (opcional)
          <textarea
            id="nota"
            className="mayoreo-input min-h-[72px]"
            maxLength={500}
            value={nota}
            onChange={(e) => onNota(e.target.value)}
          />
        </label>
      </div>

      <BarraAccionFija>
        <div className="flex flex-col gap-2">
          <button
            className={BTN_PRIMARIO}
            disabled={enviando || bajoMinimo}
            onClick={onEnviar}
          >
            {enviando
              ? "Enviando pedido…"
              : bajoMinimo
                ? "Completa el mínimo para enviar"
                : `Enviar pedido · ${dinero(total)}`}
          </button>
        </div>
      </BarraAccionFija>
    </div>
  );
}
