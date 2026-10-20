"use client";

import { useState } from "react";

// Contenido de popover para filtrar por texto (p. ej. nombre del negocio): aplica mientras escribes.
export function FiltroTextoPopover({
  valorAplicado,
  onAplicar,
  placeholder,
}: {
  valorAplicado: string | null;
  onAplicar: (value: string | null) => void;
  placeholder: string;
}) {
  const [texto, setTexto] = useState(valorAplicado ?? "");
  return (
    <input
      autoFocus
      value={texto}
      onChange={(e) => {
        setTexto(e.target.value);
        onAplicar(e.target.value.trim() || null);
      }}
      placeholder={placeholder}
      aria-label={placeholder}
      className="admin-input w-full"
    />
  );
}
