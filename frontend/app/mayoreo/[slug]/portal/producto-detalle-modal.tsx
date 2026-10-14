"use client";

import { useState } from "react";
import CantidadInput, {
  cantidadNumero,
  type Cantidad,
} from "@/components/cantidad-input";

const OVERLAY =
  "fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4";
const CARD =
  "w-full max-w-sm rounded-t-xl bg-mayoreo-card p-5 shadow-lg sm:rounded-xl";
const INCREMENT_BTN =
  "flex-1 rounded-lg border border-mayoreo-border bg-mayoreo-bg py-2 text-sm font-semibold text-mayoreo-ink transition hover:bg-mayoreo-accent-soft";
const BTN_PRIMARY =
  "flex-1 rounded-lg bg-mayoreo-button px-4 py-3 text-sm font-semibold text-white hover:brightness-95";
const BTN_SECONDARY =
  "flex-1 rounded-lg border border-mayoreo-border px-4 py-3 text-sm font-semibold text-mayoreo-ink-soft hover:bg-mayoreo-bg";

/** Lo que el modal necesita de un producto del catálogo del portal. */
export interface ProductoModal {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: number | string;
  fotoUrl: string | null;
}

export default function ProductoDetalleModal({
  product,
  cantidadInicial,
  onConfirm,
  onClose,
  etiquetaCantidad = "Cantidad total de tu pedido",
  textoConfirmar,
}: {
  product: ProductoModal;
  cantidadInicial: number;
  onConfirm: (cantidad: number) => void;
  onClose: () => void;
  /** Texto sobre el control de cantidad (por defecto el de «Crear pedido»). */
  etiquetaCantidad?: string;
  /** Si se da, el botón siempre dice esto y no deja confirmar con 0 (para agregar un producto nuevo). */
  textoConfirmar?: string;
}) {
  // Puede quedar vacío mientras se escribe; vacío cuenta como 0 al guardar.
  const [campo, setCampo] = useState<Cantidad>(cantidadInicial);
  const cantidad = cantidadNumero(campo);

  function incrementar(delta: number) {
    setCampo((prev) => Math.max(0, cantidadNumero(prev) + delta));
  }

  return (
    <div className={OVERLAY} onClick={onClose}>
      <div className={CARD} onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-3">
          {product.fotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- external, tenant-provided URLs
            <img
              src={product.fotoUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-xl object-cover"
            />
          ) : null}
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold text-mayoreo-ink">
              {product.nombre}
            </h2>
            {product.descripcion && (
              <p className="text-sm text-mayoreo-ink-soft">
                {product.descripcion}
              </p>
            )}
            <span className="text-sm font-semibold text-mayoreo-accent">
              ${Number(product.precio).toFixed(2)}
            </span>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          <span className="text-xs font-medium text-mayoreo-ink-soft">
            {etiquetaCantidad}
          </span>

          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => incrementar(-1)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-mayoreo-border text-lg font-semibold text-mayoreo-ink hover:bg-mayoreo-bg"
              aria-label="Quitar una pieza"
            >
              −
            </button>
            <CantidadInput
              value={campo}
              onChange={setCampo}
              aria-label="Cantidad total"
              className="mayoreo-input w-24 text-center text-lg font-semibold placeholder:font-normal placeholder:text-mayoreo-ink-soft/40"
            />
            <button
              type="button"
              onClick={() => incrementar(1)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-mayoreo-border text-lg font-semibold text-mayoreo-ink hover:bg-mayoreo-bg"
              aria-label="Agregar una pieza"
            >
              +
            </button>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => incrementar(1)}
              className={INCREMENT_BTN}
            >
              +1
            </button>
            <button
              type="button"
              onClick={() => incrementar(5)}
              className={INCREMENT_BTN}
            >
              +5
            </button>
            <button
              type="button"
              onClick={() => incrementar(10)}
              className={INCREMENT_BTN}
            >
              +10
            </button>
            <button
              type="button"
              onClick={() => setCampo(0)}
              className={INCREMENT_BTN}
            >
              Reiniciar
            </button>
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(cantidad)}
            disabled={textoConfirmar !== undefined && cantidad <= 0}
            className={`${BTN_PRIMARY} disabled:opacity-50`}
          >
            {textoConfirmar ?? (cantidad > 0 ? "Guardar" : "Quitar del pedido")}
          </button>
        </div>
      </div>
    </div>
  );
}
