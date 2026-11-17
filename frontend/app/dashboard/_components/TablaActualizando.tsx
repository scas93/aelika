"use client";

import { ReactNode, useCallback, useState } from "react";

// Ayudante compartido por los listados con filtros: la tabla conserva el resultado anterior mientras llega el nuevo, pero NO lo
// presenta como válido. Se atenúa (sin vaciarla ni mover nada) desde el MISMO render que pinta el chip o el valor del filtro,
// incluso antes de que arranque la consulta (que corre en un efecto, después del render).
//
// Uso:
//   const { actualizando, registrar } = useTablaActualizando({ filtros, hayResultado: result !== null, cargando });
//   … al llegar la respuesta (o el error) de una consulta:  registrar(firmaDe(filtrosConLosQueSePidio))
//   … <TablaActualizando actualizando={actualizando}>{tabla}</TablaActualizando>

/** Firma estable de un conjunto de filtros (el orden de las claves es el del objeto; los `undefined` no cuentan). */
export const firmaDe = (filtros: unknown) => JSON.stringify(filtros);

export function useTablaActualizando({
  filtros,
  hayResultado,
  cargando = false,
}: {
  /** Todo lo que cambia el resultado (filtros, búsqueda, página…), tal como se manda a la consulta. */
  filtros: unknown;
  hayResultado: boolean;
  /** Hay una consulta en curso (p. ej. el mismo filtro recargado tras editar un registro). */
  cargando?: boolean;
}) {
  const [firmaResultado, setFirmaResultado] = useState<string | null>(null);
  const registrar = useCallback((firma: string) => setFirmaResultado(firma), []);
  const actualizando = hayResultado && (cargando || firmaResultado !== firmaDe(filtros));
  return { actualizando, registrar };
}

/** Misma caja y mismo espaciado que sin envolver (sin saltos de diseño); atenuada y sin clics mientras se actualiza. */
export function TablaActualizando({ actualizando, children }: { actualizando: boolean; children: ReactNode }) {
  return (
    <div
      aria-busy={actualizando}
      className={`flex flex-col gap-3 transition-opacity duration-150 ${actualizando ? "pointer-events-none opacity-50" : ""}`}
    >
      {children}
    </div>
  );
}
