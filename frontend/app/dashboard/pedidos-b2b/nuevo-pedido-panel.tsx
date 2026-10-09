"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  createPedidoB2b,
  fetchClientesB2bSelector,
  fetchPedidoB2bExistente,
  fetchProducts,
  DIAS_SEMANA_PEDIDO_B2B,
  type ClienteB2bSelectorItem,
  type DiaSemanaPedidoB2b,
  type Product,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { cantidadNumero, type Cantidad } from "@/components/cantidad-input";
import CuadriculaDias, { distribucionVacia, totalDistribucion, type DistribucionDias } from "./cuadricula-dias";
import SidePanel from "../_components/SidePanel";
import Button from "../_components/Button";

interface LineaNueva {
  productId: string;
  nombre: string;
  precio: number;
  distribucion: DistribucionDias;
}

const DIA_MS = 24 * 60 * 60 * 1000;

// Las semanas son fechas calendario ("YYYY-MM-DD", siempre lunes): se mueven a mediodía UTC para que ningún huso las recorra.
function sumarDias(iso: string, dias: number): string {
  return new Date(new Date(`${iso}T12:00:00Z`).getTime() + dias * DIA_MS).toISOString().slice(0, 10);
}

function fechaCorta(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Captura de un pedido B2B por teléfono (Operador, Gerente y Dueño): se elige un cliente activo, la semana (por defecto la
 * siguiente, pero cualquiera), los productos por día y una nota. El descuento es el del cliente y es de solo lectura: el
 * servidor recalcula todo (aquí el total es un cálculo para verlo antes de guardar).
 */
export default function NuevoPedidoPanel({
  open,
  semanaInicial,
  onClose,
  onAbrirPedido,
  onCreado,
}: {
  open: boolean;
  // Lunes de la semana que se propone por defecto (la siguiente).
  semanaInicial: string | null;
  onClose: () => void;
  // "Abrir el pedido que ya tiene": cierra la captura y abre ese pedido en el panel lateral.
  onAbrirPedido: (pedidoId: string) => void;
  onCreado: (pedidoId: string) => void;
}) {
  const { token } = useSession();

  const [clientes, setClientes] = useState<ClienteB2bSelectorItem[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [cargaError, setCargaError] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [cliente, setCliente] = useState<ClienteB2bSelectorItem | null>(null);
  const [semana, setSemana] = useState<string | null>(semanaInicial);
  const [existente, setExistente] = useState<{ id: string; folio: string } | null>(null);
  const [lineas, setLineas] = useState<LineaNueva[]>([]);
  const [agregando, setAgregando] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al abrir: estado limpio y listas frescas (un cliente nuevo o dado de baja desde la última vez debe reflejarse).
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reinicia el formulario cada vez que se abre el panel */
    setBusqueda("");
    setCliente(null);
    setSemana(semanaInicial);
    setExistente(null);
    setLineas([]);
    setAgregando("");
    setNota("");
    setError(null);
    setCargaError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchClientesB2bSelector(token)
      .then(setClientes)
      .catch((err) => setCargaError(err instanceof ApiError ? err.message : "No se pudieron cargar los clientes"));
    fetchProducts(token)
      .then(setProducts)
      .catch((err) => setCargaError(err instanceof ApiError ? err.message : "No se pudieron cargar los productos"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token]);

  // Aviso previo: ¿este cliente ya tiene pedido esa semana?
  useEffect(() => {
    if (!open || !cliente || !semana) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sin cliente o semana no hay nada que avisar
      setExistente(null);
      return;
    }
    let cancelled = false;
    setExistente(null);
    fetchPedidoB2bExistente(token, cliente.id, semana)
      .then((res) => {
        if (!cancelled) setExistente(res ?? null);
      })
      .catch(() => {
        // Si la consulta falla, el servidor igual rechaza el duplicado al guardar (409 con el folio).
      });
    return () => {
      cancelled = true;
    };
  }, [open, token, cliente, semana]);

  const coincidencias = useMemo(() => {
    if (!clientes) return [];
    const q = busqueda.trim().toLowerCase();
    const lista = q
      ? clientes.filter((c) => c.nombre.toLowerCase().includes(q) || (c.codigo ?? "").toLowerCase().includes(q))
      : clientes;
    return lista.slice(0, 6);
  }, [clientes, busqueda]);

  const productosDisponibles = (products ?? []).filter((p) => p.disponible && !lineas.some((l) => l.productId === p.id));

  function agregarProducto() {
    const product = products?.find((p) => p.id === agregando);
    if (!product) return;
    setLineas((prev) => [
      ...prev,
      { productId: product.id, nombre: product.nombre, precio: Number(product.precio), distribucion: distribucionVacia() },
    ]);
    setAgregando("");
  }

  function setCantidad(productId: string, dia: DiaSemanaPedidoB2b, cantidad: Cantidad) {
    setLineas((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, distribucion: { ...l.distribucion, [dia]: cantidad } } : l)),
    );
  }

  const subtotal = lineas.reduce((sum, l) => sum + l.precio * totalDistribucion(l.distribucion), 0);
  const porcentaje = cliente?.descuentoPorcentaje ?? 0;
  const descuento = Math.round(subtotal * porcentaje) / 100;
  const total = subtotal - descuento;
  const totalPiezas = lineas.reduce((sum, l) => sum + totalDistribucion(l.distribucion), 0);
  const lineaVacia = lineas.some((l) => totalDistribucion(l.distribucion) === 0);

  const puedeGuardar = !!cliente && !!semana && !existente && lineas.length > 0 && !lineaVacia && !guardando;

  async function handleGuardar() {
    if (!cliente || !semana) return;
    setGuardando(true);
    setError(null);
    try {
      const pedido = await createPedidoB2b(token, {
        clienteId: cliente.id,
        semanaInicio: semana,
        items: lineas.map((l) => ({
          productId: l.productId,
          distribucion: DIAS_SEMANA_PEDIDO_B2B.map(({ value }) => ({ dia: value, cantidad: cantidadNumero(l.distribucion[value]) })),
        })),
        notaCliente: nota.trim() || undefined,
      });
      onCreado(pedido.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el pedido");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Nuevo pedido"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleGuardar} disabled={!puedeGuardar}>
            {guardando ? "Guardando..." : "Guardar pedido"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {cargaError && <p className="text-sm text-red-600">{cargaError}</p>}

        {/* 1 · Cliente */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold text-admin-ink">Cliente</span>
          {cliente ? (
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-admin-control)] bg-admin-bg p-3">
              <div className="flex flex-col">
                <span className="text-sm font-bold text-admin-ink">{cliente.nombre}</span>
                <span className="text-xs text-admin-ink-soft">
                  {cliente.codigo}
                  {cliente.descuentoPorcentaje ? ` · ${cliente.descuentoPorcentaje}% de descuento` : ""}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCliente(null)}
                className="text-sm font-semibold text-mayoreo-accent hover:underline"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar cliente por nombre o código..."
                className="admin-input w-full"
                aria-label="Buscar cliente"
              />
              {clientes === null ? (
                <p className="text-sm text-admin-ink-soft">Cargando clientes...</p>
              ) : coincidencias.length === 0 ? (
                <p className="text-sm text-admin-ink-soft">
                  {clientes.length === 0 ? "Aún no hay clientes activos. Un administrador debe darlos de alta en Clientes." : "Ningún cliente coincide."}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {coincidencias.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setCliente(c)}
                        className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-admin-control)] border border-admin-border px-3 py-2 text-left transition hover:border-mayoreo-accent"
                      >
                        <span className="text-sm font-semibold text-admin-ink">{c.nombre}</span>
                        <span className="text-xs text-admin-ink-soft">
                          {c.codigo}
                          {c.descuentoPorcentaje ? ` · ${c.descuentoPorcentaje}%` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* 2 · Semana */}
        {semana && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold text-admin-ink">Semana</span>
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => setSemana(sumarDias(semana, -7))} aria-label="Semana anterior">
                ←
              </Button>
              <span className="min-w-[170px] text-center text-sm font-bold text-admin-ink">
                {fechaCorta(semana)} – {fechaCorta(sumarDias(semana, 6))}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setSemana(sumarDias(semana, 7))} aria-label="Semana siguiente">
                →
              </Button>
              {semana !== semanaInicial && semanaInicial && (
                <button
                  type="button"
                  onClick={() => setSemana(semanaInicial)}
                  className="text-xs font-semibold text-mayoreo-accent hover:underline"
                >
                  Volver a la siguiente
                </button>
              )}
            </div>
          </div>
        )}

        {/* Aviso: el cliente ya tiene pedido esa semana (no se puede capturar otro; se edita ese) */}
        {existente && (
          <div role="alert" className="flex flex-col gap-2 rounded-[var(--radius-admin-control)] border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm text-admin-ink">
              Este cliente ya tiene el pedido <span className="font-bold">{existente.folio}</span> esta semana. Para agregar o cambiar entregas, edita ese pedido.
            </p>
            <div>
              <Button variant="secondary" size="sm" onClick={() => onAbrirPedido(existente.id)}>
                Abrir {existente.folio}
              </Button>
            </div>
          </div>
        )}

        {/* 3 · Productos y cantidades por día */}
        {!existente && cliente && (
          <div className="flex flex-col gap-3">
            <span className="text-sm font-bold text-admin-ink">Productos</span>
            {lineas.map((l) => {
              const piezas = totalDistribucion(l.distribucion);
              return (
                <div key={l.productId} className="flex flex-col gap-2 rounded-[var(--radius-admin-control)] border border-admin-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-admin-ink">{l.nombre}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${piezas > 0 ? "text-admin-green-dark" : "text-red-600"}`}>{piezas} piezas</span>
                      <button
                        type="button"
                        onClick={() => setLineas((prev) => prev.filter((x) => x.productId !== l.productId))}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                  <CuadriculaDias
                    nombreProducto={l.nombre}
                    distribucion={l.distribucion}
                    onChange={(dia, cantidad) => setCantidad(l.productId, dia, cantidad)}
                  />
                </div>
              );
            })}

            <div className="flex items-center gap-2">
              <select value={agregando} onChange={(e) => setAgregando(e.target.value)} className="admin-input flex-1" aria-label="Agregar producto">
                <option value="">Agregar producto...</option>
                {productosDisponibles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={agregarProducto} disabled={!agregando}>
                Agregar
              </Button>
            </div>

            {lineaVacia && <p className="text-sm text-red-600">Indica una cantidad en cada producto o quítalo.</p>}

            <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
              Nota del cliente (opcional)
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Ej. entregar por la puerta de atrás"
                className="admin-input w-full resize-none font-normal"
              />
            </label>

            {/* Totales: el descuento es el del cliente (solo lectura) */}
            <div className="flex flex-col gap-1 border-t border-admin-border pt-3">
              <div className="flex justify-between text-sm text-admin-ink-soft">
                <span>Subtotal ({totalPiezas} piezas)</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              {porcentaje > 0 && (
                <div className="flex justify-between text-sm text-admin-green-dark">
                  <span>Descuento del cliente ({porcentaje}%)</span>
                  <span>-{formatMoney(descuento)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-admin-ink">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
              <span className="text-xs text-admin-ink-soft">Al guardar, el sistema recalcula el total con los precios vigentes.</span>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </SidePanel>
  );
}
