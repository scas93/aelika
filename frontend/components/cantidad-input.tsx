"use client";

import { useRef, type InputHTMLAttributes } from "react";

// Una cantidad que puede quedar VACÍA mientras se escribe. Un campo vacío cuenta como 0 al guardar (`cantidadNumero`).
export type Cantidad = number | "";

export function cantidadNumero(valor: Cantidad): number {
  return valor === "" ? 0 : valor;
}

// Input de cantidad compartido por el panel B2B (edición por día, corrección de entregas) y el storefront de mayoreo:
//  · el 0 NO se muestra como valor, solo como placeholder tenue — el campo queda vacío para escribir sin borrar nada;
//  · se puede borrar por completo (""), y de ahí escribir otro número;
//  · al enfocar un campo con valor se selecciona el contenido, para sobrescribirlo de un teclazo;
//  · enteros ≥ 0 (los negativos y decimales se normalizan al escribir).
// El estilo lo pone quien lo usa (`className`): .admin-input en el panel, .mayoreo-input en el storefront.
export default function CantidadInput({
  value,
  onChange,
  className,
  ...resto
}: {
  value: Cantidad;
  onChange: (valor: Cantidad) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "placeholder">) {
  // Al enfocar con el mouse, el navegador coloca el cursor en el `mouseup` y deshace la selección: se ignora ese primer mouseup.
  const recienEnfocado = useRef(false);
  return (
    <input
      {...resto}
      type="number"
      inputMode="numeric"
      min={resto.min ?? 0}
      placeholder="0"
      value={value === 0 ? "" : value}
      onChange={(e) => {
        const crudo = e.target.value;
        if (crudo === "") return onChange("");
        const n = Math.trunc(Number(crudo));
        onChange(Number.isFinite(n) ? Math.max(0, n) : "");
      }}
      onFocus={(e) => {
        recienEnfocado.current = true;
        e.currentTarget.select();
      }}
      onMouseUp={(e) => {
        if (recienEnfocado.current) e.preventDefault();
        recienEnfocado.current = false;
      }}
      className={className}
    />
  );
}
