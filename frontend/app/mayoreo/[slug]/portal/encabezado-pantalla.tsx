import Link from "next/link";
import type { ReactNode } from "react";

export const CLASE_BOTON_CIRCULAR =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-mayoreo-border bg-mayoreo-card text-mayoreo-ink shadow-sm transition active:opacity-80";

function Flecha() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

/** Botón circular «‹» para regresar. Con `href` es un enlace; con `onClick`, un botón. */
export function BotonAtras({
  href,
  onClick,
}: {
  href?: string;
  onClick?: () => void;
}) {
  if (href !== undefined)
    return (
      <Link href={href} aria-label="Atrás" className={CLASE_BOTON_CIRCULAR}>
        <Flecha />
      </Link>
    );
  return (
    <button
      type="button"
      aria-label="Atrás"
      className={CLASE_BOTON_CIRCULAR}
      onClick={onClick}
    >
      <Flecha />
    </button>
  );
}

/**
 * Encabezado de una pantalla del portal: botón «Atrás» y título en la misma línea, con un subtítulo opcional debajo.
 * El destino del botón lo decide cada pantalla.
 */
export default function EncabezadoPantalla({
  titulo,
  subtitulo,
  href,
  onAtras,
}: {
  titulo?: ReactNode;
  subtitulo?: ReactNode;
  href?: string;
  onAtras?: () => void;
}) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        {(href !== undefined || onAtras) && (
          <BotonAtras href={href} onClick={onAtras} />
        )}
        {titulo && (
          <h1 className="text-lg font-bold leading-tight">{titulo}</h1>
        )}
      </div>
      {subtitulo && (
        <p className="text-xs text-mayoreo-ink-soft">{subtitulo}</p>
      )}
    </header>
  );
}
