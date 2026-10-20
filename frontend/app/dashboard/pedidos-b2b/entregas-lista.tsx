"use client";

import { useState, type ReactNode } from "react";
import { formatMoney } from "@/lib/format";
import { ApiError, type CorregirEntregaPedidoB2bPayload, type Product } from "@/lib/api";
import CantidadInput, { cantidadNumero, type Cantidad } from "@/components/cantidad-input";
import Badge from "../_components/Badge";
import Button from "../_components/Button";
import { ESTADO_ENTREGA_LABEL, ESTADO_ENTREGA_VARIANT } from "./estado";
import { entregaAbiertaPorDefecto, fechaCorta, type EntregaVista } from "./entregas-vista";

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

// Bloque de entregas del pedido, compartido por el panel del pedido y el historial del cliente. Una fila plegable por entrega
// («Mié 21 oct» + estado); al abrirla, sus productos con el importe de la línea. El monto es ANTES del
// descuento (el descuento se aplica una sola vez en los totales). Abierta por defecto: la atrasada, o si no la próxima pendiente.
// Sin `onCerrar`/`onCorregir` es solo lectura. Con `onCerrar`, la entrega pendiente abierta ofrece "Entregada" / "No recogida"
// (una por una, nunca en bloque); con `onCorregir` (solo admin), la ya cerrada ofrece "Corregir".
export default function EntregasLista({
  entregas,
  onCerrar,
  onCorregir,
  productos,
  cargarProductos,
  encabezadoAccion,
}: {
  entregas: EntregaVista[];
  onCerrar?: (entregaId: string, estado: "ENTREGADA" | "NO_RECOGIDA") => Promise<void>;
  onCorregir?: (entregaId: string, payload: CorregirEntregaPedidoB2bPayload) => Promise<void>;
  productos?: Product[] | null;
  cargarProductos?: () => void;
  /** Junto al título de la sección (p. ej. «Editar pedido»). */
  encabezadoAccion?: ReactNode;
}) {
  const [cerrando, setCerrando] = useState<string | null>(null);
  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = sin tocar: rige el default (que se recalcula si cambian las entregas, p. ej. al cerrar una).
  const [manual, setManual] = useState<Set<string> | null>(null);
  const abiertas = manual ?? new Set([entregaAbiertaPorDefecto(entregas)].filter((x): x is string => x !== null));

  function alternar(id: string) {
    const siguiente = new Set(abiertas);
    if (siguiente.has(id)) siguiente.delete(id);
    else siguiente.add(id);
    setManual(siguiente);
  }

  // Un producto sin productId (ya no existe en el catálogo) no se puede reenviar: bloquea la corrección de esa entrega.
  function lineasDe(entrega: EntregaVista): { lineas: LineaCorreccion[]; bloqueada: boolean } {
    const lineas: LineaCorreccion[] = [];
    let bloqueada = false;
    for (const p of entrega.productos) {
      if (!p.productId) bloqueada = true;
      else lineas.push({ productId: p.productId, nombreProducto: p.nombreProducto, cantidad: p.cantidad as Cantidad });
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
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-admin-ink">Entregas</span>
        {encabezadoAccion}
      </div>
      {entregas.length === 0 && <p className="text-xs text-admin-ink-soft">Este pedido no tiene entregas.</p>}
      <ul className="flex flex-col gap-2">
        {entregas.map((entrega) => {
          const pendiente = entrega.estado === "PENDIENTE" || entrega.estado === "LISTA";
          const cerrada = entrega.estado === "ENTREGADA" || entrega.estado === "NO_RECOGIDA";
          const cancelada = entrega.estado === "CANCELADA";
          const abierta = abiertas.has(entrega.id);
          const { lineas, bloqueada } = lineasDe(entrega);
          return (
            <li key={entrega.id} className={`flex flex-col gap-2 rounded-[var(--radius-admin-control)] border border-admin-border p-3 ${cancelada ? "bg-admin-bg" : ""}`}>
              <button
                type="button"
                onClick={() => alternar(entrega.id)}
                aria-expanded={abierta}
                className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
              >
                <span className={`text-sm font-semibold ${cancelada ? "text-admin-ink-soft" : "text-admin-ink"}`}>
                  <span className="mr-1.5 text-xs text-admin-ink-soft">{abierta ? "▼" : "▶"}</span>
                  {fechaCorta(entrega.fecha)}
                </span>
                <span className="flex items-center gap-1.5">
                  {entrega.atrasada && <Badge variant="peligro">Atrasada</Badge>}
                  <Badge variant={ESTADO_ENTREGA_VARIANT[entrega.estado]}>{ESTADO_ENTREGA_LABEL[entrega.estado]}</Badge>
                </span>
              </button>
              {abierta && (
                <>
                  <ul className={`flex flex-col gap-0.5 text-xs ${cancelada ? "text-admin-ink-soft" : "text-admin-ink"}`}>
                    {entrega.productos.map((p, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span>
                          {p.nombreProducto} × {p.cantidad}
                        </span>
                        <span className="tabular-nums">{formatMoney(p.cantidad * p.precioUnitario)}</span>
                      </li>
                    ))}
                  </ul>
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
                </>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
