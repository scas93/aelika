"use client";

import { useEffect, useState } from "react";

// «Móvil» = por debajo del breakpoint md de Tailwind (768 px). Se usa cuando la versión de teléfono cambia QUÉ se pinta (no solo
// cómo se ve): p. ej. las acciones de la fila del título pasan de botones con texto a «+» y un menú «⋯». Sin matchMedia (pruebas,
// servidor) se asume computadora.
const CONSULTA = "(max-width: 767px)";

export function useEsMovil(): boolean {
  const [movil, setMovil] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(CONSULTA);
    const actualizar = () => setMovil(mq.matches);
    actualizar();
    mq.addEventListener("change", actualizar);
    return () => mq.removeEventListener("change", actualizar);
  }, []);
  return movil;
}
