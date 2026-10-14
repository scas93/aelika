"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductoCatalogoPortal } from "@/lib/portal-api";
import { dinero } from "./estilos";

interface Props {
  titulo: string;
  categorias: {
    id: string;
    nombre: string;
    products: ProductoCatalogoPortal[];
  }[];
  /** Productos que ya están en ese día: no se ofrecen. */
  excluidos: Set<string>;
  onElegir: (producto: ProductoCatalogoPortal) => void;
  onCerrar: () => void;
}

// Distancia de arrastre hacia abajo (px) a partir de la cual la hoja se cierra al soltar.
const UMBRAL_CIERRE = 80;

// Hoja inferior para elegir un producto del catálogo: buscador y lista por categoría (mismo patrón que el paso de productos de «Crear pedido»).
export default function HojaAgregarProducto({
  titulo,
  categorias,
  excluidos,
  onElegir,
  onCerrar,
}: Props) {
  const [busqueda, setBusqueda] = useState("");
  const [arrastre, setArrastre] = useState(0);
  const [arrastrando, setArrastrando] = useState(false);
  const inicioY = useRef<number | null>(null);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return categorias
      .map((c) => ({
        ...c,
        products: c.products.filter(
          (p) =>
            !excluidos.has(p.id) &&
            (!q || p.nombre.toLowerCase().includes(q)),
        ),
      }))
      .filter((c) => c.products.length > 0);
  }, [categorias, excluidos, busqueda]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-2xl bg-mayoreo-card text-mayoreo-ink shadow-lg"
        style={{
          transform: arrastre ? `translateY(${arrastre}px)` : undefined,
          transition: arrastrando ? undefined : "transform 0.2s",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado: también es el asa para deslizar hacia abajo y cerrar. */}
        <div
          className="flex shrink-0 touch-none flex-col gap-2 px-4 pt-2"
          onTouchStart={(e) => {
            inicioY.current = e.touches[0].clientY;
            setArrastrando(true);
          }}
          onTouchMove={(e) => {
            if (inicioY.current === null) return;
            setArrastre(Math.max(0, e.touches[0].clientY - inicioY.current));
          }}
          onTouchEnd={() => {
            const cerrar = arrastre > UMBRAL_CIERRE;
            inicioY.current = null;
            setArrastrando(false);
            setArrastre(0);
            if (cerrar) onCerrar();
          }}
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-mayoreo-border" />
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{titulo}</h2>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={onCerrar}
              className="flex h-11 w-11 shrink-0 items-center justify-center text-lg text-mayoreo-ink-soft"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="shrink-0 px-4 pb-3">
          <input
            className="mayoreo-input w-full"
            type="search"
            placeholder="Buscar producto"
            aria-label="Buscar producto"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-6">
          {visibles.length === 0 && (
            <p className="text-sm text-mayoreo-ink-soft">
              {busqueda
                ? `No encontramos nada para “${busqueda}”.`
                : "No hay más productos para agregar."}
            </p>
          )}
          {visibles.map((c) => (
            <section key={c.id} className="flex flex-col">
              <h3 className="pb-1 text-sm font-semibold text-mayoreo-ink-soft">
                {c.nombre}
              </h3>
              <ul className="flex flex-col divide-y divide-mayoreo-border">
                {c.products.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onElegir(p)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm active:opacity-80"
                    >
                      <span className="min-w-0 font-medium">{p.nombre}</span>
                      <span className="shrink-0 tabular-nums text-mayoreo-ink-soft">
                        {dinero(p.precio)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
