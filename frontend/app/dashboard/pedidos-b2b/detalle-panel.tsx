"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconArrowRight, IconCheck, IconPencil } from "@tabler/icons-react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  avanzarPedidoB2b,
  marcarRevisadoPedidoB2b,
  cancelarPedidoB2b,
  cerrarEntregaPedidoB2b,
  corregirEntregaPedidoB2b,
  desmarcarPagadoPedidoB2b,
  fetchPedidoB2b,
  marcarPagadoPedidoB2b,
  fetchProducts,
  updatePedidoB2bItems,
  DIAS_SEMANA_PEDIDO_B2B,
  type CorregirEntregaPedidoB2bPayload,
  type DiaSemanaPedidoB2b,
  type PedidoB2bDetalle,
  type Product,
} from "@/lib/api";
import { formatMoney, formatFechaHora } from "@/lib/format";
import { cantidadNumero, type Cantidad } from "@/components/cantidad-input";
import CuadriculaDias, {
  distribucionVacia,
  totalDistribucion,
  type DistribucionDias,
} from "./cuadricula-dias";
import {
  ESTADO_VARIANT,
  ESTADO_LABEL,
  ESTADO_PAGO_LABEL,
  ESTADO_PAGO_VARIANT,
  puedeCerrarEntregas,
} from "./estado";
import EntregasLista from "./entregas-lista";
import SidePanel from "../_components/SidePanel";
import Aviso from "../_components/Aviso";
import Modal from "../_components/Modal";
import Button from "../_components/Button";
import Badge from "../_components/Badge";
import { formatearFolioB2b } from "@/lib/format";
import {
  entregasDesdePedido,
  fechaCorta,
} from "./entregas-vista";

// Estado local de edición — una fila por producto, con un id propio
// (independiente de productId) porque dos líneas del pedido podrían
// referenciar el mismo producto (el storefront público no lo prohíbe, ver
// pedidos-b2b-logica.ts), y porque un producto agregado aquí todavía no
// tiene un PedidoB2bItem.id real.
interface EditItem {
  localId: string;
  productId: string;
  nombreProducto: string;
  // Una cantidad puede quedar vacía mientras se escribe; vacío cuenta como 0 al guardar.
  distribucion: DistribucionDias;
}

// Los items sin productId (el producto original se borró del catálogo — ver
// onDelete: SetNull en OrderItem/PedidoB2bItem) se excluyen del modo edición:
// el backend necesita un producto vivo para resolver nombre/precio al
// reenviar el pedido completo (PATCH /:id/items es un reemplazo total), así
// que no hay forma de reincluirlos tal cual.
function itemsEditablesDesdePedido(pedido: PedidoB2bDetalle): {
  items: EditItem[];
  omitidos: number;
} {
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
    items.push({
      localId: item.id,
      productId: item.productId,
      nombreProducto: item.nombreProducto,
      distribucion,
    });
  }
  return { items, omitidos };
}

function totalItem(item: EditItem): number {
  return totalDistribucion(item.distribucion);
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
  const router = useRouter();
  // Admin (Gerente/Dueño): pagos y correcciones de entregas cerradas. El Operador edita, confirma y cancela, pero un
  // pedido Pagado le queda bloqueado para editar y cancelar (el servidor también responde 403).
  const esAdmin = user.rol === "GERENTE" || user.rol === "DUENO";

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
  const [pagando, setPagando] = useState(false);
  const [revisando, setRevisando] = useState(false);
  const [confirmPago, setConfirmPago] = useState<"marcar" | "desmarcar" | null>(
    null,
  );
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
      .catch((err) =>
        setLoadError(
          err instanceof ApiError ? err.message : "No se pudo cargar el pedido",
        ),
      );
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

  function setCantidadDia(
    localId: string,
    dia: DiaSemanaPedidoB2b,
    cantidad: Cantidad,
  ) {
    setEditItems((prev) =>
      prev.map((item) =>
        item.localId === localId
          ? { ...item, distribucion: { ...item.distribucion, [dia]: cantidad } }
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
            cantidad: cantidadNumero(item.distribucion[value]),
          })),
        })),
        // Control de concurrencia: si el cliente modificó el pedido mientras se editaba, el servidor responde 409.
        pedido.updatedAt,
      );
      // La respuesta de editar no trae las entregas (solo GET /:id y cerrar las traen): se vuelve a leer el pedido.
      setPedido(await fetchPedidoB2b(token, pedido.id));
      setEditMode(false);
      onChanged();
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "No se pudo guardar el pedido",
      );
      // 409: el pedido cambió desde que se abrió (p. ej. el cliente lo modificó). Se recarga y se sale de la edición, para
      // que no se vuelva a guardar encima de lo que hizo el cliente.
      if (err instanceof ApiError && err.status === 409) {
        try {
          setPedido(await fetchPedidoB2b(token, pedido.id));
          setEditMode(false);
          onChanged();
        } catch {
          // si no se pudo recargar, el mensaje ya pide recargar a mano
        }
      }
    } finally {
      setGuardando(false);
    }
  }

  // «Marcar como revisado»: apaga la marca «Modificado por el cliente» sin cambiar nada más (los 3 roles).
  async function handleRevisado() {
    if (!pedido) return;
    setRevisando(true);
    setActionError(null);
    try {
      await marcarRevisadoPedidoB2b(token, pedido.id);
      setPedido(await fetchPedidoB2b(token, pedido.id));
      onChanged();
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "No se pudo marcar como revisado",
      );
    } finally {
      setRevisando(false);
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
      setActionError(
        err instanceof ApiError
          ? err.message
          : "No se pudo confirmar el pedido",
      );
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
      setActionError(
        err instanceof ApiError ? err.message : "No se pudo cancelar el pedido",
      );
    } finally {
      setCancelando(false);
    }
  }

  // Por confirmar → Confirmado es lo único manual; En proceso / Completado salen de cerrar entregas.
  // Confirmar y cancelar son de Gerente/Dueño (el servidor también responde 403 al Operador).
  const puedeConfirmar = esAdmin && pedido?.estado === "PENDIENTE_CONFIRMACION" && !pedido.cancelado;
  // Cerrar entregas es operativo: lo pueden hacer los 3 roles (no depende del rol).
  const puedeCerrar = pedido
    ? puedeCerrarEntregas(pedido.estado, pedido.cancelado)
    : false;

  async function handleCerrarEntrega(
    entregaId: string,
    estado: "ENTREGADA" | "NO_RECOGIDA",
  ) {
    if (!pedido) return;
    const actualizado = await cerrarEntregaPedidoB2b(
      token,
      pedido.id,
      entregaId,
      estado,
    );
    setPedido(actualizado);
    onChanged();
  }
  const pagado = pedido?.estadoPago === "PAGADO";
  const puedeModificar = esAdmin || !pagado;

  // Días cuya entrega ya está cerrada (Entregada / No recogida): en la edición se ven bloqueados con su estado — se cambian
  // con "Corregir" en esa entrega, no aquí (el servidor también lo rechaza con 409).
  const diasCerrados = new Map<
    DiaSemanaPedidoB2b,
    "ENTREGADA" | "NO_RECOGIDA"
  >();
  for (const e of pedido?.entregas ?? []) {
    if (e.estado === "ENTREGADA" || e.estado === "NO_RECOGIDA")
      diasCerrados.set(e.dia, e.estado);
  }

  // Pago (solo Gerente/Dueño), en cualquier estado del pedido, incluso Cancelado. No mueve el estado del pedido.
  async function handlePago(marcar: boolean) {
    if (!pedido) return;
    setPagando(true);
    setActionError(null);
    try {
      if (marcar) await marcarPagadoPedidoB2b(token, pedido.id);
      else await desmarcarPagadoPedidoB2b(token, pedido.id);
      setConfirmPago(null);
      setPedido(await fetchPedidoB2b(token, pedido.id)); // la respuesta del pago no trae las entregas ni la fecha: se vuelve a leer
      onChanged();
    } catch (err) {
      setConfirmPago(null);
      setActionError(
        err instanceof ApiError ? err.message : "No se pudo actualizar el pago",
      );
    } finally {
      setPagando(false);
    }
  }

  // Corrección del admin sobre una entrega ya cerrada. Los errores los muestra el propio formulario de la entrega.
  async function handleCorregirEntrega(
    entregaId: string,
    payload: CorregirEntregaPedidoB2bPayload,
  ) {
    if (!pedido) return;
    setPedido(
      await corregirEntregaPedidoB2b(token, pedido.id, entregaId, payload),
    );
    onChanged();
  }

  function cargarProductos() {
    if (!products) {
      fetchProducts(token)
        .then(setProducts)
        .catch(() => {});
    }
  }

  const productosDisponibles =
    products?.filter(
      (p) => !editItems.some((item) => item.productId === p.id),
    ) ?? [];

  const entregasVista = pedido ? entregasDesdePedido(pedido) : [];
  const pedidoOriginal = pedido ? pedido.items.reduce((s, i) => s + Number(i.precioUnitario) * i.cantidadTotal, 0) : 0;
  // «Editar pedido» (encabezado de Entregas): donde el servidor deja editar — cualquier estado no cancelado, incluido
  // Completado; al Operador le queda bloqueado un pedido Pagado.
  const puedeEditarAhora = puedeModificar && !pedido?.cancelado;
  const puedeCancelar = !!pedido && esAdmin && pedido.estado !== "COMPLETADO" && !pedido.cancelado;
  // En un cancelado solo se cobra lo entregado: «Marcar pagado» aparece únicamente si «A cobrar» es mayor que $0.
  const puedeMarcarPagado = esAdmin && !pagado && !!pedido && (!pedido.cancelado || Number(pedido.total) > 0);

  // Pie fijo: Por confirmar → Confirmar (principal) + Cancelar; Confirmado / En proceso → solo Cancelar, discreto;
  // Completado / Cancelado → sin pie. Se oculta mientras se edita (el editor trae sus propios botones).
  const pie =
    pedido && !editMode && (puedeConfirmar || puedeCancelar) ? (
      <div className="flex w-full flex-col gap-2">
        {actionError && <p className="text-sm text-red-600">{actionError}</p>}
        <div className="flex items-center justify-end gap-3 max-md:flex-col-reverse max-md:items-stretch max-md:[&>button]:w-full">
          {puedeCancelar && puedeConfirmar && (
            <Button variant="danger" onClick={() => setConfirmCancelOpen(true)} disabled={cancelando || avanzando}>
              Cancelar pedido
            </Button>
          )}
          {puedeCancelar && !puedeConfirmar && (
            <button
              type="button"
              onClick={() => setConfirmCancelOpen(true)}
              disabled={cancelando}
              className="text-sm font-semibold text-red-600 hover:underline disabled:opacity-50"
            >
              Cancelar pedido
            </button>
          )}
          {puedeConfirmar && (
            <Button variant="primary" onClick={handleAvanzar} disabled={avanzando || cancelando}>
              {avanzando ? "Confirmando..." : "Confirmar pedido"}
            </Button>
          )}
        </div>
      </div>
    ) : undefined;

  return (
    <SidePanel
      open={pedidoId !== null}
      onClose={onClose}
      title={pedido ? `Semana del ${fechaCorta(pedido.semanaInicio, false)}` : "Pedido"}
      subtitle={
        pedido ? (
          <Badge variant={pedido.cancelado ? "peligro" : ESTADO_VARIANT[pedido.estado]}>
            {pedido.cancelado ? "Cancelado" : ESTADO_LABEL[pedido.estado]}
          </Badge>
        ) : undefined
      }
      footer={pie}
    >
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {!pedido && !loadError && <p className="text-sm text-admin-ink-soft">Cargando...</p>}

      {pedido && (
        <div className="flex flex-col gap-5">
          {pedido.cancelado && <Aviso tono="rojo">Cancelado{pedido.canceladoAt ? ` el ${formatFechaHora(pedido.canceladoAt)}` : ""}</Aviso>}

          {!pedido.cancelado && pedido.modificadoPorClienteAt && (
            <Aviso
              tono="ambar"
              accion={{ label: revisando ? "Guardando..." : "Marcar como revisado", onClick: () => void handleRevisado(), disabled: revisando || editMode }}
            >
              Modificado por el cliente desde el portal
              {pedido.estado === "PENDIENTE_CONFIRMACION" ? " · la marca se apaga al confirmarlo" : ""}
            </Aviso>
          )}

          {/* Tarjeta de montos y pago: el único lugar del panel con el total. Marcar pagado (Gerente/Dueño) pide confirmación
              (modal con folio y total). En un cancelado, «Pedido original» va como línea y el total es lo que queda por cobrar. */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-admin-control)] border border-admin-border p-4">
            <div className="flex flex-col gap-1">
              {pedido.cancelado && (
                <div className="flex justify-between text-sm text-admin-ink-soft">
                  <span>Pedido original</span>
                  <span>{formatMoney(pedidoOriginal)}</span>
                </div>
              )}
              {/* Sin descuento, el subtotal es igual al total: solo se muestra el Total. */}
              {Number(pedido.descuentoTotal) > 0 && (
                <>
                  <div className="flex justify-between text-sm text-admin-ink-soft">
                    <span>Subtotal</span>
                    <span>{formatMoney(pedido.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-admin-green-dark">
                    <span>
                      Descuento
                      {pedido.descuentoPorcentajeAplicado
                        ? ` (${Number(pedido.descuentoPorcentajeAplicado)}%)`
                        : pedido.codigoDescuentoTexto
                          ? ` (${pedido.codigoDescuentoTexto})`
                          : ""}
                    </span>
                    <span>-{formatMoney(pedido.descuentoTotal)}</span>
                  </div>
                </>
              )}
              <div className="flex items-baseline justify-between text-admin-ink">
                <span className="text-sm font-bold">{pedido.cancelado ? "Total a cobrar" : "Total"}</span>
                <span className="text-2xl font-bold leading-none">{formatMoney(pedido.total)}</span>
              </div>
              {/* Mínimo 0 = el pedido se creó sin mínimo: no hay leyenda de piezas mínimas. */}
              {pedido.minimoPiezasAplicado > 0 && (
                <span className="text-xs text-admin-ink-soft">
                  {pedido.totalPiezas} / {pedido.minimoPiezasAplicado} piezas mínimas
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-admin-border pt-3">
              <span className="flex items-center gap-1.5 text-xs text-admin-ink-soft">
                Pago:
                <Badge variant={ESTADO_PAGO_VARIANT[pedido.estadoPago]}>{ESTADO_PAGO_LABEL[pedido.estadoPago]}</Badge>
              </span>
              {puedeMarcarPagado && (
                <Button variant="secondary" size="xs" onClick={() => setConfirmPago("marcar")} disabled={pagando || editMode}>
                  <IconCheck size={12} className="shrink-0" />
                  Marcar pagado
                </Button>
              )}
              {esAdmin && pagado && (
                <button
                  type="button"
                  onClick={() => setConfirmPago("desmarcar")}
                  disabled={pagando || editMode}
                  className="text-xs font-semibold text-admin-ink-soft hover:underline disabled:opacity-50"
                >
                  Desmarcar pago
                </button>
              )}
            </div>
          </div>

          {pedido.notaCliente && (
            <Aviso tono="neutro">
              <span className="font-bold">Nota del cliente:</span> <span className="whitespace-pre-wrap">{pedido.notaCliente}</span>
            </Aviso>
          )}

          {!editMode ? (
            <EntregasLista
              key={pedido.id}
              entregas={entregasVista}
              onCerrar={puedeCerrar ? handleCerrarEntrega : undefined}
              onCorregir={esAdmin ? handleCorregirEntrega : undefined}
              productos={products}
              cargarProductos={cargarProductos}
              encabezadoAccion={
                puedeEditarAhora ? (
                  <Button variant="secondary" size="xs" onClick={startEdit}>
                    <IconPencil size={12} className="shrink-0" />
                    Editar
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="flex flex-col gap-3">
              <span className="text-sm font-bold text-admin-ink">
                Editar productos
              </span>
              {diasCerrados.size > 0 && (
                <p className="rounded-[var(--radius-admin-control)] bg-admin-bg p-2 text-xs text-admin-ink-soft">
                  Los días con entrega cerrada están bloqueados:{" "}
                  {DIAS_SEMANA_PEDIDO_B2B.filter(({ value }) =>
                    diasCerrados.has(value),
                  )
                    .map(
                      ({ value, label }) =>
                        `${label.slice(0, 3)} (${diasCerrados.get(value) === "ENTREGADA" ? "Entregada" : "No recogida"})`,
                    )
                    .join(", ")}
                  . Para cambiarlos usa «Corregir» en esa entrega.
                </p>
              )}
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
                      <span className="text-sm font-semibold text-admin-ink">
                        {item.nombreProducto}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-semibold ${total > 0 ? "text-admin-green-dark" : "text-red-600"}`}
                        >
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
                    <CuadriculaDias
                      nombreProducto={item.nombreProducto}
                      distribucion={item.distribucion}
                      onChange={(dia, cantidad) =>
                        setCantidadDia(item.localId, dia, cantidad)
                      }
                      cerrados={diasCerrados}
                    />
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
                <Button
                  variant="secondary"
                  onClick={addProduct}
                  disabled={!addingProductId}
                >
                  Agregar
                </Button>
              </div>

              {editItems.length === 0 && (
                <p className="text-sm text-red-600">
                  El pedido necesita al menos un producto.
                </p>
              )}

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={cancelEdit}
                  disabled={guardando}
                >
                  Cancelar edición
                </Button>
                <Button
                  variant="primary"
                  onClick={handleGuardar}
                  disabled={guardando || editItems.length === 0}
                >
                  {guardando ? "Guardando..." : "Guardar cambios"}
                </Button>
              </div>
            </div>
          )}

          {!editMode && (
            // Mismo patrón que Entregas: título fuera de la tarjeta, acción a la derecha en la misma fila.
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-admin-ink">Cliente</span>
                {/* «Ver cliente» solo para Gerente/Dueño: son los roles con acceso al módulo de Clientes. */}
                {esAdmin && pedido.clienteId && (
                  <Button variant="secondary" size="xs" onClick={() => router.push(`/dashboard/clientes?cliente=${pedido.clienteId}`)}>
                    Ver cliente
                    <IconArrowRight size={12} className="shrink-0" />
                  </Button>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-admin-control)] border border-admin-border p-4">
                <span className="text-sm font-bold text-admin-ink">{pedido.negocioNombre}</span>
                <span className="text-sm text-admin-ink-soft">
                  {[pedido.contactoNombre, pedido.contactoTelefono, pedido.contactoCorreo].filter(Boolean).join(" · ")}
                </span>
              </div>
            </div>
          )}

          {editMode && actionError && <p className="text-sm text-red-600">{actionError}</p>}
        </div>
      )}

      <Modal
        open={confirmPago !== null}
        onClose={() => {
          if (!pagando) setConfirmPago(null);
        }}
        title={
          confirmPago === "desmarcar"
            ? "¿Desmarcar el pago?"
            : "¿Marcar como pagado?"
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmPago(null)}
              disabled={pagando}
            >
              Volver
            </Button>
            <Button
              variant="primary"
              onClick={() => handlePago(confirmPago === "marcar")}
              disabled={pagando}
            >
              {pagando
                ? "Guardando..."
                : confirmPago === "desmarcar"
                  ? "Sí, desmarcar"
                  : "Sí, marcar pagado"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-admin-ink">
          {confirmPago === "desmarcar"
            ? `¿Desmarcar el pago del pedido ${pedido ? formatearFolioB2b(pedido.folio) : ""}?`
            : `¿Marcar el pedido ${pedido ? formatearFolioB2b(pedido.folio) : ""} como pagado?`}{" "}
          <span className="font-semibold">
            Total: {pedido ? formatMoney(pedido.total) : ""}
          </span>
        </p>
        {confirmPago === "desmarcar" && pedido?.modoCobro === "AL_INICIO" && (
          <p className="mt-2 text-xs text-admin-ink-soft">
            Este negocio cobra por adelantado: desmarcar el pago no regresa el
            pedido a Por confirmar; seguirá {ESTADO_LABEL[pedido.estado]}.
          </p>
        )}
      </Modal>

      <Modal
        open={confirmCancelOpen}
        onClose={() => {
          if (!cancelando) setConfirmCancelOpen(false);
        }}
        title="¿Cancelar este pedido?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmCancelOpen(false)}
              disabled={cancelando}
            >
              Volver
            </Button>
            <Button
              variant="danger"
              onClick={handleCancelar}
              disabled={cancelando}
            >
              {cancelando ? "Cancelando..." : "Sí, cancelar"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-admin-ink-soft">
          Esta acción no se puede deshacer. El pedido{" "}
          {pedido ? formatearFolioB2b(pedido.folio) : ""} de{" "}
          {pedido?.negocioNombre} quedará cancelado: las entregas ya cerradas se
          conservan y se cobran; las pendientes se cancelan y no se cobran.
        </p>
      </Modal>
    </SidePanel>
  );
}
