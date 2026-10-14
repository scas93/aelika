"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// El contenedor de la página (WRAPPER) deja 32 px abajo (pb-8) y 16 px de separación (gap-4) sobre este espaciador.
// Para que la última tarjeta quede justo arriba de la barra, con 16 px (lo mismo que entre tarjetas), el espaciador
// mide la altura real de la barra menos esos 32 px de relleno de la página.
const RELLENO_PAGINA = 32;

// Barra fija inferior con la acción principal del paso (Continuar / Ver resumen / Volver al menú). La altura que se
// reserva al final del contenido es la medida de la barra, así no queda un hueco de más ni se tapa la última tarjeta.
export default function BarraAccionFija({ children }: { children: ReactNode }) {
  const barra = useRef<HTMLDivElement>(null);
  const [alto, setAlto] = useState(0);

  useLayoutEffect(() => {
    const el = barra.current;
    if (!el) return;
    const medir = () => setAlto(el.getBoundingClientRect().height);
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <div
        style={{ height: Math.max(0, alto - RELLENO_PAGINA) }}
        aria-hidden="true"
      />
      <div
        ref={barra}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-mayoreo-border bg-mayoreo-bg"
      >
        <div className="mx-auto w-full max-w-md px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </>
  );
}
