"use client";

import { etiquetaFecha } from "@/lib/portal-calendario-formato";
import { rangoSemanaTexto } from "@/lib/pedido-b2b-fechas";
import type { ProblemaFechaPortal } from "@/lib/portal-api";
import type { EntregaPedidoPortal } from "@/lib/portal-api";
import type { TotalesSemana } from "@/lib/portal-pedido-modelo";
import {
  AVISO,
  BTN_PRIMARIO,
  BTN_SECUNDARIO,
  CARD,
  ERROR,
  dinero,
} from "../estilos";

interface Props {
  entregas: EntregaPedidoPortal[];
  nombres: Map<string, string>;
  precios: Record<string, number>;
  totales: TotalesSemana[];
  descuentoPorcentaje: number;
  minimoPiezas: number;
  nota: string;
  onNota: (n: string) => void;
  enviando: boolean;
  error: string | null;
  problemas: ProblemaFechaPortal[];
  favoritoEstado: "ninguno" | "guardando" | "guardado" | "error";
  onGuardarFavorito: () => void;
  onEnviar: () => void;
}

// Paso 4: resumen con totales por semana (un pedido por semana), nota opcional y envío.
export default function PasoResumen({
  entregas,
  nombres,
  precios,
  totales,
  descuentoPorcentaje,
  minimoPiezas,
  nota,
  onNota,
  enviando,
  error,
  problemas,
  favoritoEstado,
  onGuardarFavorito,
  onEnviar,
}: Props) {
  const total = totales.reduce((s, t) => s + t.total, 0);
  const bajoMinimo = totales.some((t) => t.faltanPiezas > 0);
  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <h2 className="text-lg font-bold">Revisa tu pedido</h2>
        {totales.length > 1 && (
          <p className="text-sm text-mayoreo-ink-soft">
            Elegiste días de dos semanas: se crea un pedido por semana, los dos
            al mismo tiempo.
          </p>
        )}
      </div>

      {totales.map((t) => (
        <section key={t.semanaInicio} className={CARD + " gap-3"}>
          <h3 className="text-sm font-semibold">
            Semana del {rangoSemanaTexto(t.semanaInicio, t.semanaFin)}
          </h3>
          {entregas
            .filter((e) => t.fechas.includes(e.fecha))
            .map((e) => (
              <div key={e.fecha} className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {etiquetaFecha(e.fecha)}
                </span>
                {e.items.map((it) => (
                  <span
                    key={it.productId}
                    className="flex justify-between text-sm text-mayoreo-ink-soft"
                  >
                    <span>
                      {it.cantidad} × {nombres.get(it.productId) ?? "Producto"}
                    </span>
                    <span>
                      {dinero((precios[it.productId] ?? 0) * it.cantidad)}
                    </span>
                  </span>
                ))}
              </div>
            ))}
          <div className="flex flex-col gap-0.5 border-t border-mayoreo-border pt-2 text-sm">
            <span className="flex justify-between">
              <span>Subtotal ({t.piezas} piezas)</span>
              <span>{dinero(t.subtotal)}</span>
            </span>
            {descuentoPorcentaje > 0 && (
              <span className="flex justify-between text-mayoreo-ink-soft">
                <span>Descuento {descuentoPorcentaje}%</span>
                <span>−{dinero(t.descuento)}</span>
              </span>
            )}
            <span className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{dinero(t.total)}</span>
            </span>
          </div>
          {t.faltanPiezas > 0 && (
            <p className={ERROR}>
              Esta semana necesita al menos {minimoPiezas} piezas: te faltan{" "}
              {t.faltanPiezas}. Regresa a agregar productos.
            </p>
          )}
        </section>
      ))}

      <div className={CARD + " gap-2"}>
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
        {totales.length > 1 && (
          <p className="text-xs text-mayoreo-ink-soft">
            La nota se guarda en los dos pedidos.
          </p>
        )}
      </div>

      <div className={CARD + " gap-2"}>
        <button
          className={BTN_SECUNDARIO}
          disabled={favoritoEstado === "guardando" || enviando}
          onClick={onGuardarFavorito}
        >
          {favoritoEstado === "guardando"
            ? "Guardando favorito…"
            : favoritoEstado === "guardado"
              ? "Guardado como tu favorito ✓"
              : "Guardar como mi favorito"}
        </button>
        <p className="text-xs text-mayoreo-ink-soft">
          Tu favorito guarda los productos y cantidades por día de la semana (de
          la primera semana que elegiste), sin precios. Reemplaza al favorito
          anterior.
        </p>
        {favoritoEstado === "error" && (
          <p className={ERROR}>
            No pudimos guardar tu favorito. Intenta de nuevo.
          </p>
        )}
      </div>

      {problemas.length > 0 && (
        <div className="flex flex-col gap-1">
          {problemas.map((p) => (
            <p key={p.fecha} className={ERROR}>
              {p.mensaje}
            </p>
          ))}
          <p className={AVISO}>
            Actualizamos el calendario. Revisa tus días y vuelve a enviar.
          </p>
        </div>
      )}
      {error && problemas.length === 0 && <p className={ERROR}>{error}</p>}

      <div className="flex flex-col gap-1">
        <button
          className={BTN_PRIMARIO}
          disabled={enviando || bajoMinimo}
          onClick={onEnviar}
        >
          {enviando ? "Enviando pedido…" : `Enviar pedido · ${dinero(total)}`}
        </button>
        <p className="text-center text-xs text-mayoreo-ink-soft">
          El pedido queda por confirmar hasta que el negocio lo confirme.
        </p>
      </div>
    </div>
  );
}
