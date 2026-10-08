"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  avanzarPedidoB2b,
  cancelarPedidoB2b,
  cerrarEntregaPedidoB2b,
  fetchPedidoB2b,
  fetchProducts,
  updatePedidoB2bItems,
  DIAS_SEMANA_PEDIDO_B2B,
  type DiaSemanaPedidoB2b,
  type PedidoB2bDetalle,
  type Product,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { ESTADO_VARIANT, ESTADO_LABEL, puedeCerrarEntregas } from "./estado";
import EntregasLista from "./entregas-lista";
import SidePanel from "../_components/SidePanel";
import Modal from "../_components/Modal";
import Button from "../_components/Button";
import Badge from "../_components/Badge";

// Estado local de edición — una fila por producto, con un id propio
// (independiente de productId) porque dos líneas del pedido podrían
// referenciar el mismo producto (el storefront público no lo prohíbe, ver
// pedidos-b2b-logica.ts), y porque un producto agregado aquí todavía no
// tiene un PedidoB2bItem.id real.
interface EditItem {
  localId: string;
  productId: string;
  nombreProducto: string;
  distribucion: Record<DiaSemanaPedidoB2b, number>;
}

function distribucionVacia(): Record<DiaSemanaPedidoB2b, number> {
  return DIAS_SEMANA_PEDIDO_B2B.reduce(
    (acc, { value }) => {
      acc[value] = 0;
      return acc;
    },
    {} as Record<DiaSemanaPedidoB2b, number>,
  );
}

// Los items sin productId (el producto original se borró del catálogo — ver
// onDelete: SetNull en OrderItem/PedidoB2bItem) se excluyen del modo edición:
// el backend necesita un producto vivo para resolver nombre/precio al
// reenviar el pedido completo (PATCH /:id/items es un reemplazo total), así
// que no hay forma de reincluirlos tal cual.
function itemsEditablesDesdePedido(pedido: PedidoB2bDetalle): { items: EditItem[]; omitidos: number } {
  const items: EditItem[] = [];
  let omitidos = 0;
  for (const item of pedido.items) {
    if (!item.productId) {
      omitidos += 1;
      continue;
    }
    const distribucion = distribucionVacia();
    for (const d of item.distribucion) {
      distribucion[d.dia] = d.cantidad;
    }
    items.push({ localId: item.id, productId: item.productId, nombreProducto: item.nombreProducto, distribucion });
  }
  return { items, omitidos };
}

function totalItem(item: EditItem): number {
  return DIAS_SEMANA_PEDIDO_B2B.reduce((sum, { value }) => sum + (item.distribucion[value] || 0), 0);
}

export default function DetallePanel({
  pedidoId,
  onClose,
  onChanged,
}: {
  pedidoId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { token, user } = useSession();
  const canWrite = user.rol === "GERENTE" || user.rol === "DUENO";

  const [pedido, setPedido] = useState<PedidoB2bDetalle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [itemsOmitidos, setItemsOmitidos] = useState(0);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [addingProductId, setAddingProductId] = useState("");

  const [avanzando, setAvanzando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!pedidoId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets panel state when the selected pedidoId is cleared
      setPedido(null);
      setEditMode(false);
      return;
    }
    setLoadError(null);
    setActionError(null);
    setEditMode(false);
    fetchPedidoB2b(token, pedidoId)
      .then(setPedido)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el pedido"));
  }, [pedidoId, token]);

  function startEdit() {
    if (!pedido) return;
    const { items, omitidos } = itemsEditablesDesdePedido(pedido);
    setEditItems(items);
    setItemsOmitidos(omitidos);
    setActionError(null);
    setEditMode(true);
    if (!products) {
      fetchProducts(token)
        .then(setProducts)
        .catch(() => {});
    }
  }

  function cancelEdit() {
    setEditMode(false);
    setActionError(null);
  }

  function setCantidadDia(localId: string, dia: DiaSemanaPedidoB2b, cantidad: number) {
    setEditItems((prev) =>
      prev.map((item) =>
        item.localId === localId
          ? { ...item, distribucion: { ...item.distribucion, [dia]: Math.max(0, cantidad) } }
          : item,
      ),
    );
  }

  function removeItem(localId: string) {
    setEditItems((prev) => prev.filter((item) => item.localId !== localId));
  }

  function addProduct() {
    if (!addingProductId || !products) return;
    const product = products.find((p) => p.id === addingProductId);
    if (!product) return;
    setEditItems((prev) => [
      ...prev,
      {
        localId: `nuevo-${product.id}`,
        productId: product.id,
        nombreProducto: product.nombre,
        distribucion: distribucionVacia(),
      },
    ]);
    setAddingProductId("");
  }

  async function handleGuardar() {
    if (!pedido) return;
    setGuardando(true);
    setActionError(null);
    try {
      await updatePedidoB2bItems(
        token,
        pedido.id,
        editItems.map((item) => ({
          productId: item.productId,
          distribucion: DIAS_SEMANA_PEDIDO_B2B.map(({ value }) => ({
            dia: value,
            cantidad: item.distribucion[value] || 0,
          })),
        })),
      );
      // La respuesta de editar no trae las entregas (solo GET /:id y cerrar las traen): se vuelve a leer el pedido.
      setPedido(await fetchPedidoB2b(token, pedido.id));
      setEditMode(false);
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo guardar el pedido");
    } finally {
      setGuardando(false);
    }
  }

  async function handleAvanzar() {
    if (!pedido) return;
    setAvanzando(true);
    setActionError(null);
    try {
      await avanzarPedidoB2b(token, pedido.id);
      setPedido(await fetchPedidoB2b(token, pedido.id));
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo confirmar el pedido");
    } finally {
      setAvanzando(false);
    }
  }

  async function handleCancelar() {
    if (!pedido) return;
    setCancelando(true);
    setActionError(null);
    try {
      await cancelarPedidoB2b(token, pedido.id);
      setConfirmCancelOpen(false);
      onChanged();
      onClose();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo cancelar el pedido");
    } finally {
      setCancelando(false);
    }
  }

  // Por confirmar → Confirmado es lo único manual; En proceso / Completado salen de cerrar entregas.
  const puedeConfirmar = pedido?.estado === "PENDIENTE_CONFIRMACION";
  // Cerrar entregas es operativo: lo pueden hacer los 3 roles (no depende de canWrite).
  const puedeCerrar = pedido ? puedeCerrarEntregas(pedido.estado, pedido.cancelado) : false;

  async function handleCerrarEntrega(entregaId: string, estado: "ENTREGADA" | "NO_RECOGIDA") {
    if (!pedido) return;
    const actualizado = await cerrarEntregaPedidoB2b(token, pedido.id, entregaId, estado);
    setPedido(actualizado);
    onChanged();
  }
  const pagado = pedido?.estadoPago === "PAGADO";

  const productosDisponibles = products?.filter((p) => !editItems.some((item) => item.productId === p.id)) ?? [];

  return (
    <SidePanel open={pedidoId !== null} onClose={onClose} title={pedido ? `Pedido #${pedido.folio}` : "Pedido"}>
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {!pedido && !loadError && <p className="text-sm text-admin-ink-soft">Cargando...</p>}

      {pedido && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <Badge variant={pedido.cancelado ? "peligro" : ESTADO_VARIANT[pedido.estado]}>
              {pedido.cancelado ? "Cancelado" : ESTADO_LABEL[pedido.estado]}
            </Badge>
            <span className="text-sm text-admin-ink-soft">
              {/* timeZone: "UTC" — ver comentario en pedidos-b2b/page.tsx (formatFecha) */}
              Semana del{" "}
              {new Date(pedido.semanaInicio).toLocaleDateString("es-MX", {
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              })}
            </span>
          </div>

          <div className="flex flex-col gap-1 rounded-[var(--radius-admin-control)] bg-admin-bg p-3">
            <span className="text-sm font-bold text-admin-ink">{pedido.negocioNombre}</span>
            <span className="text-sm text-admin-ink-soft">
              {pedido.contactoNombre} · {pedido.contactoTelefono}
            </span>
            <span className="text-sm text-admin-ink-soft">{pedido.contactoCorreo}</span>
          </div>

          {!editMode && pedido.entregas && pedido.entregas.length > 0 && (
            <EntregasLista entregas={pedido.entregas} onCerrar={puedeCerrar ? handleCerrarEntrega : undefined} />
          )}

          {!editMode ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-admin-ink">Productos</span>
                {canWrite && !pagado && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="text-sm font-semibold text-mayoreo-accent hover:underline"
                  >
                    Editar
                  </button>
                )}
              </div>
              {pagado && (
                <p className="text-xs text-admin-ink-soft">
                  Este pedido ya está pagado — para agregar más producto, crea un pedido nuevo.
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {pedido.items.map((item) => (
                  <li key={item.id} className="flex flex-col gap-0.5 border-b border-admin-border pb-2 last:border-0">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-admin-ink">
                        {item.nombreProducto} × {item.cantidadTotal}
                      </span>
                      <span className="text-admin-ink-soft">
                        {formatMoney(Number(item.precioUnitario) * item.cantidadTotal)}
                      </span>
                    </div>
                    <span className="text-xs text-admin-ink-soft">
                      {DIAS_SEMANA_PEDIDO_B2B.filter(({ value }) => item.distribucion.some((d) => d.dia === value))
                        .map(({ value, label }) => `${label} ${item.distribucion.find((d) => d.dia === value)?.cantidad}`)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <span className="text-sm font-bold text-admin-ink">Editar productos</span>
              {itemsOmitidos > 0 && (
                <p className="text-xs text-admin-ink-soft">
                  {itemsOmitidos === 1
                    ? "Un producto de este pedido ya no existe en el catálogo y no se puede editar."
                    : `${itemsOmitidos} productos de este pedido ya no existen en el catálogo y no se pueden editar.`}
                </p>
              )}

              {editItems.map((item) => {
                const total = totalItem(item);
                return (
                  <div
                    key={item.localId}
                    className="flex flex-col gap-2 rounded-[var(--radius-admin-control)] border border-admin-border p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-admin-ink">{item.nombreProducto}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold ${total > 0 ? "text-admin-green-dark" : "text-red-600"}`}>
                          {total} piezas
                        </span>
                        <button
                          type="button"
                          onClick={() => removeItem(item.localId)}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                    {/* 7 columnas iguales que nunca desbordan (minmax(0,1fr)). .admin-input trae padding 12px 16px sin capa,
                        que (igual que `color`) gana a las utilidades de Tailwind: por eso el padding y el color van con `!` — si no, se comía el
                        espacio del número. Sin las flechas nativas del input para dar el ancho al texto (las flechas del
                        teclado ↑/↓ siguen funcionando). Un 0 se atenúa para ver de un vistazo qué días tienen pedido. */}
                    <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1">
                      {DIAS_SEMANA_PEDIDO_B2B.map(({ value, label }) => (
                        <label key={value} className="flex min-w-0 flex-col items-center gap-1">
                          <span className="text-[10px] font-medium text-admin-ink-soft">{label.slice(0, 3)}</span>
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={item.distribucion[value]}
                            onChange={(e) => setCantidadDia(item.localId, value, Number(e.target.value) || 0)}
                            className={`admin-input w-full min-w-0 px-0! py-1.5! text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
                              item.distribucion[value] > 0 ? "font-semibold text-admin-ink!" : "text-admin-ink-soft/40!"
                            }`}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center gap-2">
                <select
                  value={addingProductId}
                  onChange={(e) => setAddingProductId(e.target.value)}
                  className="admin-input flex-1"
                >
                  <option value="">Agregar producto...</option>
                  {productosDisponibles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" onClick={addProduct} disabled={!addingProductId}>
                  Agregar
                </Button>
              </div>

              {editItems.length === 0 && <p className="text-sm text-red-600">El pedido necesita al menos un producto.</p>}

              <div className="flex gap-2">
                <Button variant="secondary" onClick={cancelEdit} disabled={guardando}>
                  Cancelar edición
                </Button>
                <Button variant="primary" onClick={handleGuardar} disabled={guardando || editItems.length === 0}>
                  {guardando ? "Guardando..." : "Guardar cambios"}
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1 border-t border-admin-border pt-3">
            <div className="flex justify-between text-sm text-admin-ink-soft">
              <span>Subtotal</span>
              <span>{formatMoney(pedido.subtotal)}</span>
            </div>
            {Number(pedido.descuentoTotal) > 0 && (
              <div className="flex justify-between text-sm text-admin-green-dark">
                <span>Descuento{pedido.codigoDescuentoTexto ? ` (${pedido.codigoDescuentoTexto})` : ""}</span>
                <span>-{formatMoney(pedido.descuentoTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-admin-ink">
              <span>Total</span>
              <span>{formatMoney(pedido.total)}</span>
            </div>
            <span className="text-xs text-admin-ink-soft">
              {pedido.totalPiezas} / {pedido.minimoPiezasAplicado} piezas mínimas
            </span>
          </div>

          {actionError && <p className="text-sm text-red-600">{actionError}</p>}

          {canWrite && !editMode && (
            <div className="flex flex-wrap gap-2 border-t border-admin-border pt-3">
              {puedeConfirmar && (
                <Button variant="primary" onClick={handleAvanzar} disabled={avanzando}>
                  {avanzando ? "Confirmando..." : "Confirmar pedido"}
                </Button>
              )}
              {pedido.estado !== "COMPLETADO" && !pedido.cancelado && (
                <Button variant="danger" onClick={() => setConfirmCancelOpen(true)} disabled={cancelando}>
                  Cancelar pedido
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <Modal
        open={confirmCancelOpen}
        onClose={() => {
          if (!cancelando) setConfirmCancelOpen(false);
        }}
        title="¿Cancelar este pedido?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmCancelOpen(false)} disabled={cancelando}>
              Volver
            </Button>
            <Button variant="danger" onClick={handleCancelar} disabled={cancelando}>
              {cancelando ? "Cancelando..." : "Sí, cancelar"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-admin-ink-soft">
          Esta acción no se puede deshacer. El pedido #{pedido?.folio} de {pedido?.negocioNombre} quedará cancelado: las
          entregas ya cerradas se conservan y se cobran; las pendientes se cancelan y no se cobran.
        </p>
      </Modal>
    </SidePanel>
  );
}
