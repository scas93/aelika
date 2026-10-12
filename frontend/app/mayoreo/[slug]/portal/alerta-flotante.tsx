"use client";

import { useEffect } from "react";

export const DURACION_ALERTA_MS = 3000;

/**
 * Alerta flotante: visible arriba de la pantalla y desaparece sola a los 3 segundos. No bloquea nada
 * (`pointer-events-none`: los toques pasan a lo que hay debajo) y no tapa los botones de abajo.
 * `onCerrar` se llama al vencer el tiempo; quien la usa la quita de su estado.
 */
export default function AlertaFlotante({
  mensaje,
  onCerrar,
}: {
  mensaje: string;
  onCerrar: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onCerrar, DURACION_ALERTA_MS);
    return () => clearTimeout(t);
    // Un mensaje nuevo reinicia la cuenta de 3 segundos; onCerrar no debe reiniciarla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensaje]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4"
    >
      <p className="max-w-md rounded-xl bg-mayoreo-button px-4 py-3 text-sm font-medium text-white shadow-lg">
        {mensaje}
      </p>
    </div>
  );
}
