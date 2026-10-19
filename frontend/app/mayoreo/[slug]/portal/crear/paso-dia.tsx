"use client";

import { useEffect, useRef } from "react";
import type { CatalogoPortal, FavoritoPortal } from "@/lib/portal-api";
import {
  etiquetaFechaCorta,
  etiquetaTabDia,
} from "@/lib/portal-calendario-formato";
import {
  diaSemanaDeFecha,
  diasVacios,
  favoritoDelDia,
  losDia,
  mismasCantidades,
  nombreDiaSemana,
  piezasDia,
  type PorDia,
} from "@/lib/portal-pedido-modelo";
import { BTN_PRIMARIO } from "../estilos";
import ControlCantidad from "../control-cantidad";
import BarraAccionFija from "./barra-accion-fija";

interface Props {
  catalogo: CatalogoPortal;
  /** Días elegidos, en orden cronológico. */
  fechas: string[];
  fechaActiva: string;
  porDia: PorDia;
  /** Se llegó desde «Editar» del resumen: el botón principal regresa al resumen en vez de ir al día siguiente. */
  desdeResumen: boolean;
  onCantidad: (fecha: string, productId: string, cantidad: number) => void;
  onCopiar: (origen: string, destino: string) => void;
  /** Favoritos del cliente por día de la semana; null = no cargaron: el flujo sigue sin las acciones de favorito. */
  favorito: FavoritoPortal | null;
  guardandoFavorito: boolean;
  onUsarFavorito: (fecha: string) => void;
  onGuardarFavorito: (fecha: string) => void;
  onIr: (fecha: string) => void;
  onResumen: () => void;
}

// Paso por día: pestañas con los días elegidos, catálogo completo agrupado por categoría y barra fija con el avance.
// Cada día debe tener al menos un producto para avanzar. El servidor recibe estas cantidades por fecha tal cual.
export default function PasoDia({
  catalogo,
  fechas,
  fechaActiva,
  porDia,
  desdeResumen,
  onCantidad,
  onCopiar,
  favorito,
  guardandoFavorito,
  onUsarFavorito,
  onGuardarFavorito,
  onIr,
  onResumen,
}: Props) {
  const lineas = porDia[fechaActiva] ?? {};
  const piezas = piezasDia(lineas);
  const indice = fechas.indexOf(fechaActiva);
  const siguiente = fechas[indice + 1] as string | undefined;
  const vacios = diasVacios(porDia, fechas);
  const otroVacio = vacios.find((f) => f !== fechaActiva);

  // Copiar: en cualquier día que no sea el primero, mientras esté vacío y el primer día tenga productos. Siempre copia
  // del primer día del pedido (si se quita el primero, el nuevo primero es la base).
  const primero = fechas[0];
  const puedeCopiar =
    fechaActiva !== primero && piezas === 0 && piezasDia(porDia[primero]) > 0;

  // Favorito del día de la semana de esta fecha («tu lunes favorito»).
  const dia = diaSemanaDeFecha(fechaActiva);
  const nombreFav = nombreDiaSemana(dia);
  const hayFavorito = Object.keys(favoritoDelDia(favorito, dia)).length > 0;

  // Barra de acciones del día.
  //  · Día vacío: UNA decisión, «¿Cómo empiezas el [día]?», con los botones disponibles (Igual que… y/o Mi favorito).
  //  · Día con productos: «Tu [día] favorito ✓» si coincide con el favorito, o «¿Siempre pides así…? — Guardar favorito».
  // Sin acciones aplicables no hay barra.
  type Opcion = {
    clave: string;
    etiqueta: string;
    icono: "copiar" | "estrella";
    onClick: () => void;
  };
  const opciones: Opcion[] = [];
  if (piezas === 0) {
    if (puedeCopiar)
      opciones.push({
        clave: "copiar",
        etiqueta: `Igual que ${etiquetaTabDia(primero).toLowerCase()}`,
        icono: "copiar",
        onClick: () => onCopiar(primero, fechaActiva),
      });
    if (hayFavorito)
      opciones.push({
        clave: "usar",
        etiqueta: "Mi favorito",
        icono: "estrella",
        onClick: () => onUsarFavorito(fechaActiva),
      });
  }
  type Fila = {
    clave: string;
    texto: string;
    boton?: { etiqueta: string; onClick: () => void };
  };
  const filas: Fila[] = [];
  if (piezas > 0 && favorito) {
    if (hayFavorito && mismasCantidades(lineas, favoritoDelDia(favorito, dia)))
      filas.push({ clave: "es", texto: `Tu ${nombreFav} favorito ✓` });
    else
      filas.push({
        clave: "guardar",
        texto: `¿Siempre pides así ${losDia(dia)}?`,
        boton: {
          etiqueta: "Guardar favorito",
          onClick: () => onGuardarFavorito(fechaActiva),
        },
      });
  }

  // Al cambiar de día se vuelve arriba.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [fechaActiva]);

  // La pestaña activa se mantiene a la vista en la tira horizontal.
  const tabActiva = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    tabActiva.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [fechaActiva]);

  const irACategoria = (id: string) =>
    document
      .getElementById(`cat-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });

  const ultimoDia = !siguiente;
  const puedeAvanzar =
    piezas > 0 && (desdeResumen || !ultimoDia || otroVacio === undefined);
  const textoBoton = desdeResumen
    ? "Volver al resumen"
    : siguiente
      ? `Siguiente: ${etiquetaTabDia(siguiente)}`
      : "Ver resumen";
  const pista =
    piezas === 0
      ? "Agrega al menos un pan"
      : !desdeResumen && ultimoDia && otroVacio
        ? `Falta llenar el ${etiquetaTabDia(otroVacio)}`
        : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Pestañas de días + chips de categoría: quedan pegados arriba al hacer scroll. */}
      <div className="sticky top-0 z-30 -mx-4 flex flex-col gap-2 bg-mayoreo-bg px-4 py-2 shadow-[0_1px_0_0_var(--color-mayoreo-border)]">
        <div
          className="flex gap-1.5 overflow-x-auto pb-1"
          role="tablist"
          aria-label="Días de entrega"
        >
          {fechas.map((f) => {
            const activa = f === fechaActiva;
            const n = piezasDia(porDia[f]);
            return (
              <button
                key={f}
                ref={activa ? tabActiva : undefined}
                type="button"
                role="tab"
                aria-selected={activa}
                onClick={() => onIr(f)}
                className={`flex min-w-[4.25rem] shrink-0 flex-col items-center rounded-xl border px-3 py-1.5 text-sm transition ${
                  activa
                    ? "border-mayoreo-button bg-mayoreo-button text-white"
                    : "border-mayoreo-border bg-mayoreo-card text-mayoreo-ink"
                }`}
              >
                <span className="font-semibold">{etiquetaTabDia(f)}</span>
                <span
                  className={`text-xs ${
                    // «vacío» siempre en naranja de aviso: más claro sobre el fondo oscuro de la pestaña activa.
                    n === 0
                      ? activa
                        ? "text-amber-300"
                        : "text-amber-700"
                      : activa
                        ? "text-white/80"
                        : "text-mayoreo-ink-soft"
                  }`}
                >
                  {n === 0 ? "vacío" : `${n} pzs`}
                </span>
              </button>
            );
          })}
        </div>
        <div
          className="flex gap-2 overflow-x-auto"
          role="navigation"
          aria-label="Categorías"
        >
          {catalogo.categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => irACategoria(c.id)}
              className="shrink-0 rounded-full border border-mayoreo-border bg-mayoreo-card px-3 py-1 text-sm font-medium text-mayoreo-ink transition active:opacity-80"
            >
              {c.nombre}
            </button>
          ))}
        </div>
      </div>

      {opciones.length > 0 && (
        <div
          className="flex flex-col gap-2 rounded-xl bg-mayoreo-accent-soft px-4 py-3"
          role="group"
          aria-label="Acciones del día"
        >
          <span className="text-sm font-semibold">
            ¿Cómo empiezas el {nombreFav}?
          </span>
          <div
            className={`grid gap-2 ${opciones.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {opciones.map((o, i) => (
              <button
                key={o.clave}
                type="button"
                onClick={o.onClick}
                className={`flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2.5 text-[13px] font-semibold transition active:opacity-80 ${
                  i === 0
                    ? "bg-mayoreo-button text-white"
                    : "border border-mayoreo-border bg-mayoreo-card text-mayoreo-ink"
                }`}
              >
                <Icono tipo={o.icono} />
                {o.etiqueta}
              </button>
            ))}
          </div>
        </div>
      )}
      {filas.length > 0 && (
        <div
          className="flex flex-col gap-2 rounded-xl bg-mayoreo-accent-soft px-4 py-3"
          role="group"
          aria-label="Acciones del día"
        >
          {filas.map((f) => (
            <div
              key={f.clave}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-sm font-semibold">{f.texto}</span>
              {f.boton && (
                <button
                  type="button"
                  disabled={guardandoFavorito}
                  className="shrink-0 rounded-lg bg-mayoreo-button px-4 py-2 text-sm font-semibold text-white transition active:opacity-80 disabled:opacity-50"
                  onClick={f.boton.onClick}
                >
                  {guardandoFavorito ? "Guardando…" : f.boton.etiqueta}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {catalogo.categories.length === 0 && (
        <p className="text-sm text-mayoreo-ink-soft">
          Este negocio todavía no tiene productos disponibles.
        </p>
      )}
      {catalogo.categories.map((c) => (
        <section
          key={c.id}
          id={`cat-${c.id}`}
          className="flex scroll-mt-32 flex-col gap-2"
        >
          <h3 className="text-sm font-semibold text-mayoreo-ink-soft">
            {c.nombre}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {c.products.map((p) => {
              const cantidad = lineas[p.id] ?? 0;
              const etiqueta = `${p.nombre} el ${etiquetaFechaCorta(fechaActiva)}`;
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-3 rounded-xl border p-2 ${
                    cantidad > 0
                      ? "border-mayoreo-accent bg-mayoreo-accent-soft"
                      : "border-transparent bg-mayoreo-card"
                  }`}
                >
                  {p.fotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URLs externas del negocio
                    <img
                      src={p.fotoUrl}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span
                      className="h-12 w-12 shrink-0 rounded-lg bg-mayoreo-border"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={`min-w-0 flex-1 text-sm leading-snug ${
                      cantidad > 0 ? "font-semibold" : "font-medium"
                    }`}
                  >
                    {p.nombre}
                  </span>
                  <ControlCantidad
                    value={cantidad}
                    onChange={(n) =>
                      onCantidad(fechaActiva, p.id, Math.min(9999, n))
                    }
                    etiqueta={etiqueta}
                    etiquetaMenos={`Una pieza menos: ${etiqueta}`}
                    etiquetaMas={`Una pieza más: ${etiqueta}`}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <BarraAccionFija>
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-semibold">
              {etiquetaTabDia(fechaActiva)} · {piezas} pzs
            </span>
            {pista && <span className="text-xs text-amber-700">{pista}</span>}
          </div>
          <button
            className={BTN_PRIMARIO + " !w-auto shrink-0 px-5"}
            disabled={!puedeAvanzar}
            onClick={() =>
              desdeResumen || !siguiente ? onResumen() : onIr(siguiente)
            }
          >
            {textoBoton}
          </button>
        </div>
      </BarraAccionFija>
    </div>
  );
}

function Icono({ tipo }: { tipo: "copiar" | "estrella" }) {
  const comun = {
    viewBox: "0 0 24 24",
    className: "h-4 w-4 shrink-0",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  return tipo === "copiar" ? (
    <svg {...comun}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  ) : (
    <svg {...comun}>
      <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
    </svg>
  );
}
