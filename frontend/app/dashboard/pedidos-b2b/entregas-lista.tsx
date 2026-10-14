"use client";

import { useState } from "react";
import { ApiError, type CorregirEntregaPedidoB2bPayload, type PedidoB2bDetalle, type PedidoB2bEntrega, type Product } from "@/lib/api";
import { DIAS_SEMANA_PEDIDO_B2B } from "@/lib/api";
import CantidadInput, { cantidadNumero, type Cantidad } from "@/components/cantidad-input";
import Badge from "../_components/Badge";
import Button from "../_components/Button";
import { ESTADO_ENTREGA_LABEL, ESTADO_ENTREGA_VARIANT } from "./estado";

// timeZone: "UTC" — `fecha` es un @db.Date (medianoche UTC); en la zona local del navegador puede caer un día antes.
function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function formatCierre(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

interface LineaCorreccion {
  productId: string;
  nombreProducto: string;
  // Puede quedar vacía mientras se escribe, pero una línea en 0 no existe: vacía/0 bloquea Guardar (usa Quitar).
  cantidad: Cantidad;
}

// Editor de la corrección del admin sobre UNA entrega ya cerrada: estado (Entregada / No recogida) y el conjunto completo
// de líneas. El servidor recalcula con el precio actual del catálogo; aquí nunca se manda ni se muestra un precio.
function CorregirEntregaForm({
  estadoInicial,
  lineasIniciales,
  productos,
  onGuardar,
  onCancelar,
}: {
  estadoInicial: "ENTREGADA" | "NO_RECOGIDA";
  lineasIniciales: LineaCorreccion[];
  productos: Product[] | null;
  onGuardar: (payload: CorregirEntregaPedidoB2bPayload) => Promise<void>;
  onCancelar: () => void;
}) {
  const [estado, setEstado] = useState(estadoInicial);
  const [lineas, setLineas] = useState(lineasIniciales);
  const [agregando, setAgregando] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sinCantidad = lineas.some((l) => cantidadNumero(l.cantidad) < 1);
  const invalido = lineas.length === 0 || sinCantidad;
  const disponibles = productos?.filter((p) => !lineas.some((l) => l.productId === p.id)) ?? [];

  function agregar() {
    const p = productos?.find((x) => x.id === agregando);
    if (!p) return;
    setLineas((prev) => [...prev, { productId: p.id, nombreProducto: p.nombre, cantidad: 1 }]);
    setAgregando("");
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await onGuardar({ estado, items: lineas.map((l) => ({ productId: l.productId, cantidad: cantidadNumero(l.cantidad) })) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la corrección");
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-admin-control)] bg-admin-bg p-3">
      <span className="text-xs font-bold text-admin-ink">Corregir entrega</span>
      <div className="flex gap-2">
        <Button variant={estado === "ENTREGADA" ? "primary" : "secondary"} size="sm" onClick={() => setEstado("ENTREGADA")} disabled={guardando}>
          Entregada
        </Button>
        <Button variant={estado === "NO_RECOGIDA" ? "primary" : "secondary"} size="sm" onClick={() => setEstado("NO_RECOGIDA")} disabled={guardando}>
          No recogida
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {lineas.map((l) => (
          <li key={l.productId} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-admin-ink">{l.nombreProducto}</span>
            <CantidadInput
              min={1}
              value={l.cantidad}
              onChange={(v) => setLineas((prev) => prev.map((x) => (x.productId === l.productId ? { ...x, cantidad: v } : x)))}
              disabled={guardando}
              aria-label={`Cantidad de ${l.nombreProducto}`}
              className="admin-input w-20 px-0! py-1.5! text-center font-semibold tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none placeholder:font-normal placeholder:text-admin-ink-soft/40"
            />
            <button
              type="button"
              onClick={() => setLineas((prev) => prev.filter((x) => x.productId !== l.productId))}
              disabled={guardando}
              className="text-xs font-semibold text-red-600 hover:underline"
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <select value={agregando} onChange={(e) => setAgregando(e.target.value)} className="admin-input flex-1" disabled={guardando || !productos}>
          <option value="">{productos ? "Agregar producto..." : "Cargando productos..."}</option>
          {disponibles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        <Button variant="secondary" size="sm" onClick={agregar} disabled={!agregando || guardando}>
          Agregar
        </Button>
      </div>
      {lineas.length === 0 && <p className="text-xs text-red-600">La entrega necesita al menos un producto.</p>}
      {sinCantidad && lineas.length > 0 && <p className="text-xs text-red-600">Indica una cantidad o usa Quitar.</p>}
      <p className="text-xs text-admin-ink-soft">
        Al guardar, todas las líneas del pedido toman el precio actual del catálogo y el total se recalcula. El estado del pedido y el
        pago no cambian.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" onClick={guardar} disabled={guardando || invalido}>
          {guardando ? "Guardando..." : "Guardar corrección"}
        </Button>
      </div>
    </div>
  );
}

// Las entregas de un pedido con su estado. Con `onCerrar`, cada entrega pendiente muestra "Entregada" / "No recogida"
// (una por una, nunca en bloque). Con `onCorregir` (solo admin), cada entrega YA cerrada ofrece "Corregir". Sin ninguno es
// solo lectura.
export default function EntregasLista({
  entregas,
  items,
  onCerrar,
  onCorregir,
  productos,
  cargarProductos,
}: {
  entregas: PedidoB2bEntrega[];
  items?: PedidoB2bDetalle["items"];
  onCerrar?: (entregaId: string, estado: "ENTREGADA" | "NO_RECOGIDA") => Promise<void>;
  onCorregir?: (entregaId: string, payload: CorregirEntregaPedidoB2bPayload) => Promise<void>;
  productos?: Product[] | null;
  cargarProductos?: () => void;
}) {
  const [cerrando, setCerrando] = useState<string | null>(null);
  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Líneas de una entrega: los ítems del pedido que tienen cantidad ese día. Un ítem sin productId (el producto ya no existe
  // en el catálogo) no se puede reenviar, así que bloquea la corrección de esa entrega.
  function lineasDe(entrega: PedidoB2bEntrega): { lineas: LineaCorreccion[]; bloqueada: boolean } {
    const lineas: LineaCorreccion[] = [];
    let bloqueada = false;
    for (const item of items ?? []) {
      const d = item.distribucion.find((x) => x.dia === entrega.dia);
      if (!d) continue;
      if (!item.productId) bloqueada = true;
      else lineas.push({ productId: item.productId, nombreProducto: item.nombreProducto, cantidad: d.cantidad as Cantidad });
    }
    return { lineas, bloqueada };
  }

  async function cerrar(entregaId: string, estado: "ENTREGADA" | "NO_RECOGIDA") {
    if (!onCerrar) return;
    setCerrando(entregaId);
    setError(null);
    try {
      await onCerrar(entregaId, estado);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cerrar la entrega");
    } finally {
      setCerrando(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold text-admin-ink">Entregas</span>
      <ul className="flex flex-col gap-2">
        {entregas.map((entrega) => {
          const pendiente = entrega.estado === "PENDIENTE" || entrega.estado === "LISTA";
          const cerrada = entrega.estado === "ENTREGADA" || entrega.estado === "NO_RECOGIDA";
          const { lineas, bloqueada } = lineasDe(entrega);
          return (
            <li
              key={entrega.id}
              className="flex flex-col gap-2 rounded-[var(--radius-admin-control)] border border-admin-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-admin-ink">
                  {DIAS_SEMANA_PEDIDO_B2B.find((d) => d.value === entrega.dia)?.label ?? ""} · {formatFecha(entrega.fecha)}
                </span>
                <div className="flex items-center gap-1.5">
                  {entrega.atrasada && <Badge variant="peligro">Atrasada</Badge>}
                  <Badge variant={ESTADO_ENTREGA_VARIANT[entrega.estado]}>{ESTADO_ENTREGA_LABEL[entrega.estado]}</Badge>
                </div>
              </div>
              {entrega.cerradaAt && <span className="text-xs text-admin-ink-soft">Cerrada el {formatCierre(entrega.cerradaAt)}</span>}
              {onCorregir && cerrada && corrigiendo !== entrega.id && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bloqueada || corrigiendo !== null}
                    onClick={() => {
                      cargarProductos?.();
                      setCorrigiendo(entrega.id);
                    }}
                  >
                    Corregir
                  </Button>
                  {bloqueada && <span className="text-xs text-admin-ink-soft">Incluye un producto que ya no existe en el catálogo.</span>}
                </div>
              )}
              {onCorregir && cerrada && corrigiendo === entrega.id && (
                <CorregirEntregaForm
                  estadoInicial={entrega.estado as "ENTREGADA" | "NO_RECOGIDA"}
                  lineasIniciales={lineas}
                  productos={productos ?? null}
                  onCancelar={() => setCorrigiendo(null)}
                  onGuardar={async (payload) => {
                    await onCorregir(entrega.id, payload);
                    setCorrigiendo(null);
                  }}
                />
              )}
              {onCerrar && pendiente && (
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" onClick={() => cerrar(entrega.id, "ENTREGADA")} disabled={cerrando !== null}>
                    {cerrando === entrega.id ? "Guardando..." : "Entregada"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => cerrar(entrega.id, "NO_RECOGIDA")} disabled={cerrando !== null}>
                    No recogida
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
