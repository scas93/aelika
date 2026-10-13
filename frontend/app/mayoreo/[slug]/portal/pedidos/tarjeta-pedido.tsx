import Link from "next/link";
import type { ResumenPedidoPortal } from "@/lib/portal-api";
import {
  etiquetaFechaCorta,
  rangoSemanaCorto,
} from "@/lib/portal-calendario-formato";
import { etiquetaSemanaRelativa } from "@/lib/portal-pedidos-formato";
import PedidoChips from "./pedido-chips";
import { dinero } from "../estilos";

const MAX_DIAS = 4;

/** «Lun 19 · Mié 21 · Vie 23 · 66 pzas»; con más de 4 días, los primeros 3 y «+N». */
export function lineaDias(fechas: string[], piezas: number): string {
  const dias =
    fechas.length > MAX_DIAS
      ? [...fechas.slice(0, 3).map(etiquetaDia), `+${fechas.length - 3}`]
      : fechas.map(etiquetaDia);
  return [...dias, `${piezas} pzas`].join(" · ");
}

// «Lun 19»: día de la semana y número, sin el mes (el mes ya va en el título de la semana).
function etiquetaDia(fecha: string): string {
  const [dia, num] = etiquetaFechaCorta(fecha).split(" ");
  return `${dia} ${num}`;
}

/**
 * Tarjeta de pedido compartida por «Modificar pedido» y «Ver mis pedidos»: semana, días y piezas, estado a la
 * izquierda, total a la derecha y flecha. Sin folio, pago ni marca de modificación. `etiquetaSemana` solo se muestra si `conSemanaRelativa`.
 */
export default function TarjetaPedido({
  pedido,
  href,
  conSemanaRelativa = false,
}: {
  pedido: ResumenPedidoPortal;
  href: string;
  conSemanaRelativa?: boolean;
}) {
  const relativa = conSemanaRelativa
    ? etiquetaSemanaRelativa(pedido.semanaInicio)
    : null;
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-mayoreo-border bg-mayoreo-card p-4 shadow-sm active:opacity-80"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-base font-bold">
            Semana {rangoSemanaCorto(pedido.semanaInicio, pedido.semanaFin)}
          </span>
          {relativa && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-mayoreo-ink-soft">
              {relativa}
            </span>
          )}
        </div>
        <p className="text-sm text-mayoreo-ink-soft">
          {lineaDias(pedido.fechasEntrega ?? [], pedido.totalPiezas)}
        </p>
        <div className="flex items-end justify-between gap-2 pt-1">
          <PedidoChips pedido={pedido} />
          <span className="shrink-0 text-base">{dinero(pedido.total)}</span>
        </div>
      </div>
      <span
        aria-hidden="true"
        className="shrink-0 text-2xl leading-none text-mayoreo-ink-soft"
      >
        ›
      </span>
    </Link>
  );
}
