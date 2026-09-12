"use client";

import { useState } from "react";
import Button from "./Button";

// Contenido de popover genérico para un filtro de selección única —
// compartido por Estado (3 módulos, 3 enums/labels distintos cada uno) y
// Método de pago (pedidos/historico, pagos) en vez de reimplementar
// "select + Aplicar" por cada caso. El enum/las opciones y las etiquetas
// siguen siendo dueñas de cada módulo (se pasan por prop), este componente
// no sabe nada de dominio.
export function FiltroSelectPopover<T extends string>({
  opciones,
  valorAplicado,
  onAplicar,
  close,
}: {
  opciones: { value: T; label: string }[];
  valorAplicado: T | null;
  onAplicar: (value: T | null) => void;
  close: () => void;
}) {
  const [valor, setValor] = useState<T | "">(valorAplicado ?? "");

  function handleAplicar() {
    onAplicar(valor === "" ? null : valor);
    close();
  }

  return (
    <div className="flex flex-col gap-3">
      <select value={valor} onChange={(e) => setValor(e.target.value as T)} className="admin-input">
        <option value="">Todos</option>
        {opciones.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Button variant="primary" size="sm" onClick={handleAplicar} className="self-start">
        Aplicar
      </Button>
    </div>
  );
}
