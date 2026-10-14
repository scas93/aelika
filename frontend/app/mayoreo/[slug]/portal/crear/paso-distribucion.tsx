"use client";

import type { CatalogoPortal } from "@/lib/portal-api";
import { etiquetaFechaCorta } from "@/lib/portal-calendario-formato";
import {
  repartirParejo,
  sumaDistribucion,
  todoDistribuido,
  type Carrito,
  type Distribucion,
} from "@/lib/portal-pedido-modelo";
import { BTN_ENLACE, BTN_PRIMARIO, CARD } from "../estilos";
import ControlCantidad from "../control-cantidad";
import BarraAccionFija from "./barra-accion-fija";

interface Props {
  catalogo: CatalogoPortal;
  fechas: string[];
  carrito: Carrito;
  dist: Distribucion;
  onDist: (productId: string, porFecha: Record<string, number>) => void;
  onContinuar: () => void;
}

// Paso 3: repartir cada producto entre las fechas elegidas (fechas reales, hasta dos semanas).
export default function PasoDistribucion({
  catalogo,
  fechas,
  carrito,
  dist,
  onDist,
  onContinuar,
}: Props) {
  const nombres = new Map(
    catalogo.categories.flatMap((c) => c.products.map((p) => [p.id, p.nombre])),
  );
  const ordenadas = [...fechas].sort();
  const ids = Object.keys(carrito).filter((id) => carrito[id] > 0);
  const listo = todoDistribuido(carrito, dist, ordenadas);
  const repartidos = ids.filter(
    (id) => sumaDistribucion(dist[id], ordenadas) === carrito[id],
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-mayoreo-ink-soft">
          Reparte la cantidad de cada producto entre tus días de entrega.{" "}
          <button
            type="button"
            className={BTN_ENLACE}
            onClick={() =>
              ids.forEach((id) =>
                onDist(id, repartirParejo(carrito[id], ordenadas)),
              )
            }
          >
            Repartir todo parejo
          </button>
        </p>
      </div>

      <p
        className={`text-sm font-medium ${listo ? "text-green-700" : "text-mayoreo-ink-soft"}`}
      >
        {listo
          ? "✓ Todos los productos repartidos"
          : `${repartidos} de ${ids.length} ${ids.length === 1 ? "producto repartido" : "productos repartidos"}`}
      </p>

      {ids.map((id) => {
        const total = carrito[id];
        const repartido = sumaDistribucion(dist[id], ordenadas);
        const diferencia = total - repartido;
        const nombre = nombres.get(id) ?? "Producto";
        return (
          <section key={id} className={CARD + " gap-3"}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">{nombre}</h3>
              <span className="shrink-0 text-xs text-mayoreo-ink-soft">
                {total} pzas
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {ordenadas.map((f) => {
                const actual = dist[id]?.[f] ?? 0;
                const poner = (n: number) =>
                  onDist(id, { ...(dist[id] ?? {}), [f]: Math.max(0, n) });
                return (
                  <li
                    key={f}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-sm">{etiquetaFechaCorta(f)}</span>
                    <ControlCantidad
                      value={actual}
                      onChange={poner}
                      etiqueta={`${nombre} el ${etiquetaFechaCorta(f)}`}
                      etiquetaMenos={`Una pieza menos: ${nombre} (${etiquetaFechaCorta(f)})`}
                      etiquetaMas={`Una pieza más: ${nombre} (${etiquetaFechaCorta(f)})`}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between gap-2">
              <span
                className={`text-xs font-medium ${
                  diferencia === 0
                    ? "text-green-700"
                    : diferencia > 0
                      ? "text-amber-700"
                      : "text-red-700"
                }`}
              >
                {diferencia === 0
                  ? "✓ Todo repartido"
                  : diferencia > 0
                    ? `Faltan ${diferencia}`
                    : `Sobran ${-diferencia}`}
              </span>
              <button
                type="button"
                className="text-xs font-medium underline"
                onClick={() => onDist(id, repartirParejo(total, ordenadas))}
              >
                Repartir parejo
              </button>
            </div>
          </section>
        );
      })}

      <BarraAccionFija>
        <button
          className={BTN_PRIMARIO}
          disabled={!listo}
          onClick={onContinuar}
        >
          Ver resumen
        </button>
      </BarraAccionFija>
    </div>
  );
}
