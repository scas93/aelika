"use client";

import { useMemo, useState } from "react";
import type { CatalogoPortal, ProductoCatalogoPortal } from "@/lib/portal-api";
import { BTN_PRIMARIO, CARD, dinero } from "../estilos";
import ProductoDetalleModal from "../producto-detalle-modal";
import type { Carrito } from "@/lib/portal-pedido-modelo";

interface Props {
  catalogo: CatalogoPortal;
  carrito: Carrito;
  onCantidad: (productId: string, cantidad: number) => void;
  onContinuar: () => void;
}

// Paso 2: productos y cantidad total. La distribución por día es el paso siguiente.
export default function PasoCatalogo({
  catalogo,
  carrito,
  onCantidad,
  onContinuar,
}: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [detalle, setDetalle] = useState<ProductoCatalogoPortal | null>(null);

  const categorias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return catalogo.categories
      .map((c) => ({
        ...c,
        products: q
          ? c.products.filter((p) => p.nombre.toLowerCase().includes(q))
          : c.products,
      }))
      .filter((c) => c.products.length > 0);
  }, [catalogo, busqueda]);

  const piezas = Object.values(carrito).reduce((s, n) => s + n, 0);
  const lineas = Object.values(carrito).filter((n) => n > 0).length;

  return (
    <div className="flex flex-col gap-4">
      {detalle && (
        <ProductoDetalleModal
          product={detalle}
          cantidadInicial={carrito[detalle.id] ?? 0}
          onConfirm={(c) => {
            onCantidad(detalle.id, c);
            setDetalle(null);
          }}
          onClose={() => setDetalle(null)}
        />
      )}
      <div className={CARD + " gap-3"}>
        <h2 className="text-lg font-bold">Elige tus productos</h2>
        <input
          className="mayoreo-input"
          type="search"
          placeholder="Buscar producto"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        {catalogo.descuentoPorcentaje > 0 && (
          <p className="text-xs text-mayoreo-ink-soft">
            Tu descuento del {catalogo.descuentoPorcentaje}% se aplica al total
            de tu pedido.
          </p>
        )}
        {catalogo.minimoPiezas > 0 && (
          <p className="text-xs text-mayoreo-ink-soft">
            Cada pedido semanal necesita al menos {catalogo.minimoPiezas}{" "}
            piezas.
          </p>
        )}
      </div>

      {categorias.length === 0 && (
        <p className="text-sm text-mayoreo-ink-soft">
          {busqueda
            ? `No encontramos nada para “${busqueda}”.`
            : "Este negocio todavía no tiene productos disponibles."}
        </p>
      )}
      {categorias.map((c) => (
        <section key={c.id} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-mayoreo-ink-soft">
            {c.nombre}
          </h3>
          <ul className="flex flex-col gap-2">
            {c.products.map((p) => {
              const cantidad = carrito[p.id] ?? 0;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setDetalle(p)}
                    className="flex w-full items-center gap-3 rounded-xl bg-mayoreo-card p-3 text-left shadow-sm"
                  >
                    {p.fotoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- URLs externas del negocio
                      <img
                        src={p.fotoUrl}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded-lg object-cover"
                      />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {p.nombre}
                      </span>
                      <span className="text-sm font-semibold text-mayoreo-accent">
                        {dinero(p.precio)}
                      </span>
                    </span>
                    {cantidad > 0 ? (
                      <span className="rounded-full bg-mayoreo-accent px-2 py-0.5 text-xs font-semibold text-white">
                        {cantidad}
                      </span>
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full border border-mayoreo-border text-lg">
                        +
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <button
        className={BTN_PRIMARIO}
        disabled={lineas === 0}
        onClick={onContinuar}
      >
        Continuar
        {piezas > 0 ? ` (${piezas} ${piezas === 1 ? "pieza" : "piezas"})` : ""}
      </button>
    </div>
  );
}
