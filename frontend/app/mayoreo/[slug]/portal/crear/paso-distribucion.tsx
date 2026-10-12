"use client";

import type { CatalogoPortal } from "@/lib/portal-api";
import CantidadInput, { cantidadNumero } from "@/components/cantidad-input";
import { etiquetaFecha } from "@/lib/portal-calendario-formato";
import {
  repartirParejo,
  sumaDistribucion,
  todoDistribuido,
  type Carrito,
  type Distribucion,
} from "@/lib/portal-pedido-modelo";
import { BTN_PRIMARIO, BTN_SECUNDARIO, CARD } from "../estilos";

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

  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <h2 className="text-lg font-bold">¿Qué día quieres cada producto?</h2>
        <p className="text-sm text-mayoreo-ink-soft">
          Reparte la cantidad de cada producto entre tus días de entrega.
        </p>
      </div>

      {ids.map((id) => {
        const total = carrito[id];
        const repartido = sumaDistribucion(dist[id], ordenadas);
        const diferencia = total - repartido;
        return (
          <section key={id} className={CARD + " gap-3"}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {nombres.get(id) ?? "Producto"}
              </h3>
              <span className="text-xs text-mayoreo-ink-soft">
                Total: {total}
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {ordenadas.map((f) => (
                <li key={f} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{etiquetaFecha(f)}</span>
                  <CantidadInput
                    value={dist[id]?.[f] ?? 0}
                    onChange={(v) =>
                      onDist(id, {
                        ...(dist[id] ?? {}),
                        [f]: cantidadNumero(v),
                      })
                    }
                    aria-label={`${nombres.get(id) ?? "Producto"} el ${etiquetaFecha(f)}`}
                    className="mayoreo-input w-24 text-center"
                  />
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-2">
              <span
                className={`text-xs font-medium ${diferencia === 0 ? "text-mayoreo-ink-soft" : "text-red-700"}`}
              >
                {diferencia === 0
                  ? "Todo repartido"
                  : diferencia > 0
                    ? `Faltan ${diferencia} por repartir`
                    : `Te pasaste por ${-diferencia}`}
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

      <div className="flex flex-col gap-2">
        <button
          className={BTN_PRIMARIO}
          disabled={!listo}
          onClick={onContinuar}
        >
          Ver resumen
        </button>
        {!listo && (
          <p className="text-center text-xs text-mayoreo-ink-soft">
            Reparte todas las piezas de cada producto para continuar.
          </p>
        )}
        <button
          type="button"
          className={BTN_SECUNDARIO}
          onClick={() =>
            ids.forEach((id) =>
              onDist(id, repartirParejo(carrito[id], ordenadas)),
            )
          }
        >
          Repartir todo parejo
        </button>
      </div>
    </div>
  );
}
