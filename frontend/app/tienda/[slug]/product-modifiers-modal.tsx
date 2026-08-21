"use client";

import { useState } from "react";
import type { PublicProduct } from "@/lib/api";
import type { CartItemModifier } from "./checkout-modal";

// Generalizes checkout-modal's TOGGLE_ACTIVE/INACTIVE (built for exactly 2
// options) to N options as rounded-full pills — same active/inactive
// convention as the category tabs in page.tsx (black/white accent, never
// red — red is reserved for discounts).
const PILL_ACTIVE =
  "rounded-full bg-black px-3.5 py-1.5 text-xs font-semibold text-white transition dark:bg-white dark:text-black";
const PILL_INACTIVE =
  "rounded-full border border-black/10 bg-black/5 px-3.5 py-1.5 text-xs font-medium text-black/60 transition hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/20";
const BTN_PRIMARY =
  "rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black";

export default function ProductModifiersModal({
  product,
  precioUnitario,
  onClose,
  onConfirm,
}: {
  product: PublicProduct;
  // Post-discount unit price (same value already used for CartItem.precioUnitario
  // elsewhere) — computed by the caller (page.tsx has catalog + promotions in
  // scope), this modal never touches pricing logic beyond adding modifiers on top.
  precioUnitario: number;
  onClose: () => void;
  onConfirm: (modifiers: CartItemModifier[], cantidad: number) => void;
}) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [cantidad, setCantidad] = useState(1);

  function toggleUnica(groupId: string, optionId: string) {
    setSelections((prev) => {
      const current = prev[groupId] ?? [];
      // Clicking the already-selected pill deselects it — valid for a
      // non-obligatorio group (0 is allowed), and for an obligatorio one it
      // just leaves that group unsatisfied until another option is picked.
      return { ...prev, [groupId]: current.includes(optionId) ? [] : [optionId] };
    });
  }

  function toggleMultiple(groupId: string, optionId: string) {
    setSelections((prev) => {
      const current = prev[groupId] ?? [];
      const next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
      return { ...prev, [groupId]: next };
    });
  }

  const gruposInvalidos = product.modifierGroups.filter((grupo) => {
    if (!grupo.obligatorio) return false;
    const seleccionadas = selections[grupo.id]?.length ?? 0;
    return grupo.tipoSeleccion === "UNICA" ? seleccionadas !== 1 : seleccionadas < 1;
  });
  const canConfirm = gruposInvalidos.length === 0;

  const extraPorUnidad = product.modifierGroups.reduce((sum, grupo) => {
    const seleccionadas = selections[grupo.id] ?? [];
    return (
      sum +
      seleccionadas.reduce((s, optionId) => {
        const opcion = grupo.opciones.find((o) => o.id === optionId);
        return s + (opcion ? Number(opcion.precioAdicional) : 0);
      }, 0)
    );
  }, 0);
  // Estimate only — same principle as the rest of the storefront (floating
  // cart total, checkout "Total estimado"): the backend recalculates the
  // real total (and re-validates every selection) when the order is created.
  const totalEstimado = (precioUnitario + extraPorUnidad) * cantidad;

  function handleConfirm() {
    if (!canConfirm) return;
    const modifiers: CartItemModifier[] = product.modifierGroups.flatMap((grupo) =>
      (selections[grupo.id] ?? []).map((optionId) => {
        const opcion = grupo.opciones.find((o) => o.id === optionId)!;
        return { modifierOptionId: opcion.id, nombre: opcion.nombre, precioAdicional: Number(opcion.precioAdicional) };
      }),
    );
    onConfirm(modifiers, cantidad);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="flex max-h-[85vh] w-full max-w-sm flex-col gap-4 overflow-y-auto rounded-xl bg-white p-6 shadow-lg dark:bg-chat-card-dark">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{product.nombre}</h2>
          <button
            onClick={onClose}
            className="text-sm text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
          >
            Cerrar
          </button>
        </div>

        {product.modifierGroups.map((grupo) => (
          <div key={grupo.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{grupo.nombre}</span>
              {grupo.obligatorio && (
                <span className="text-xs font-medium text-black/50 dark:text-white/50">Obligatorio</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {grupo.opciones.map((opcion) => {
                const seleccionada = (selections[grupo.id] ?? []).includes(opcion.id);
                const precioExtra = Number(opcion.precioAdicional);
                return (
                  <button
                    key={opcion.id}
                    type="button"
                    onClick={() =>
                      grupo.tipoSeleccion === "UNICA"
                        ? toggleUnica(grupo.id, opcion.id)
                        : toggleMultiple(grupo.id, opcion.id)
                    }
                    className={seleccionada ? PILL_ACTIVE : PILL_INACTIVE}
                  >
                    {opcion.nombre}
                    {precioExtra > 0 && ` +$${precioExtra.toFixed(2)}`}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between border-t border-black/10 pt-3 dark:border-white/10">
          <span className="text-sm font-medium">Cantidad</span>
          <div className="flex items-center gap-2 rounded-full bg-black px-1.5 py-1 text-white dark:bg-white dark:text-black">
            <button
              type="button"
              onClick={() => setCantidad((c) => Math.max(1, c - 1))}
              aria-label="Quitar uno"
              className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium"
            >
              −
            </button>
            <span className="w-4 text-center text-sm font-semibold">{cantidad}</span>
            <button
              type="button"
              onClick={() => setCantidad((c) => c + 1)}
              aria-label="Agregar uno"
              className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium"
            >
              +
            </button>
          </div>
        </div>

        <button type="button" onClick={handleConfirm} disabled={!canConfirm} className={BTN_PRIMARY}>
          Agregar · ${totalEstimado.toFixed(2)}
        </button>
      </div>
    </div>
  );
}
