"use client";

import { DIAS_SEMANA_PEDIDO_B2B, type DiaSemanaPedidoB2b } from "@/lib/api";
import CantidadInput, { cantidadNumero, type Cantidad } from "@/components/cantidad-input";

export type DistribucionDias = Record<DiaSemanaPedidoB2b, Cantidad>;

export function distribucionVacia(): DistribucionDias {
  return DIAS_SEMANA_PEDIDO_B2B.reduce((acc, { value }) => {
    acc[value] = 0;
    return acc;
  }, {} as DistribucionDias);
}

export function totalDistribucion(distribucion: DistribucionDias): number {
  return DIAS_SEMANA_PEDIDO_B2B.reduce((sum, { value }) => sum + cantidadNumero(distribucion[value]), 0);
}

/**
 * Cuadrícula de 7 días (lunes a domingo) de UN producto: la usan la edición de un pedido (panel lateral) y la captura de un
 * pedido nuevo, para que las dos se vean y se comporten igual. `cerrados` marca los días con entrega ya cerrada (solo en la edición).
 *
 * 7 columnas iguales que nunca desbordan (minmax(0,1fr)). .admin-input trae padding 12px 16px sin capa, que (igual que `color`) gana a
 * las utilidades de Tailwind: por eso el padding y el color van con `!`. Sin las flechas nativas del input para dar el ancho al texto
 * (las flechas del teclado ↑/↓ siguen funcionando). Un 0 se atenúa para ver de un vistazo qué días tienen pedido.
 */
export default function CuadriculaDias({
  nombreProducto,
  distribucion,
  onChange,
  cerrados,
}: {
  nombreProducto: string;
  distribucion: DistribucionDias;
  onChange: (dia: DiaSemanaPedidoB2b, cantidad: Cantidad) => void;
  cerrados?: Map<DiaSemanaPedidoB2b, "ENTREGADA" | "NO_RECOGIDA">;
}) {
  return (
    <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1">
      {DIAS_SEMANA_PEDIDO_B2B.map(({ value, label }) => {
        const cerrado = cerrados?.get(value);
        const cantidad = distribucion[value];
        return (
          <label key={value} className="flex min-w-0 flex-col items-center gap-1">
            <span className="text-[10px] font-medium text-admin-ink-soft">{label.slice(0, 3)}</span>
            <CantidadInput
              value={cantidad}
              onChange={(v) => onChange(value, v)}
              disabled={cerrado !== undefined}
              aria-label={`${nombreProducto}, ${label}`}
              title={cerrado ? `Entrega ${cerrado === "ENTREGADA" ? "entregada" : "no recogida"}: se cambia con «Corregir»` : undefined}
              className={`admin-input w-full min-w-0 px-0! py-1.5! text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none placeholder:text-admin-ink-soft/40 ${
                cerrado ? "cursor-not-allowed opacity-60" : ""
              } ${cantidadNumero(cantidad) > 0 ? "font-semibold text-admin-ink!" : "text-admin-ink-soft/40!"}`}
            />
            <span className="h-3 text-[9px] leading-3 text-admin-ink-soft">
              {cerrado === "ENTREGADA" ? "Entregada" : cerrado === "NO_RECOGIDA" ? "No rec." : ""}
            </span>
          </label>
        );
      })}
    </div>
  );
}
