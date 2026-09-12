"use client";

import { useState } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useSession } from "@/lib/session-context";
import { ApiError, avanzarOrder, type EstadoPedido, type Order } from "@/lib/api";
import { ESTADO_LABEL, ESTADO_PAGO_VARIANT, ESTADO_PAGO_LABEL, ESTADOS, SIGUIENTE_ESTADO } from "./estado";
import Card from "../_components/Card";
import Badge from "../_components/Badge";

interface PedidosKanbanProps {
  orders: Order[];
  onAdvanced: () => void;
}

// Vista alternativa de "Activos" (ver page.tsx) — mismos datos, agrupados
// por columna en vez de en una sola lista. Soltar una tarjeta dispara el
// mismo PATCH /orders/:id/avanzar que ya usa la vista de lista (avanzarOrder,
// ver OrderCard.handleAvanzar en page.tsx) — no hay una ruta nueva de
// backend ni una segunda forma de mover un pedido de estatus.
export default function PedidosKanban({ orders, onAdvanced }: PedidosKanbanProps) {
  const { token } = useSession();
  const [movingId, setMovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // distance:8 — sin esto, useDraggable interpreta cualquier click (incluido
  // uno que no se mueve) como el inicio de un drag, y nunca se dispararía un
  // click normal. 8px de movimiento antes de armar el drag es el umbral que
  // recomienda la documentación de dnd-kit para este caso.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const porEstado: Record<EstadoPedido, Order[]> = {
    PENDIENTE_CONFIRMACION: [],
    CONFIRMADO_SURTIENDO: [],
    LISTO_ENTREGA: [],
    DESPACHADO: [],
  };
  for (const order of orders) porEstado[order.estadoPedido].push(order);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const order = orders.find((o) => o.id === active.id);
    if (!order) return;

    const estadoDestino = over.id as EstadoPedido;
    if (estadoDestino === order.estadoPedido) return; // se soltó en la misma columna

    // El servidor nunca acepta un estatus explícito — PATCH /orders/:id/avanzar
    // siempre calcula el siguiente de la secuencia fija (ver CLAUDE.md), así
    // que aquí solo se permite soltar en la columna que es literalmente el
    // siguiente paso. Saltarse una columna o retroceder no tiene ningún
    // endpoint que lo soporte: se rechaza del lado del cliente antes de
    // llamar a la API, la tarjeta se queda donde estaba (nunca se movió
    // optimistamente) y se muestra un aviso explicando por qué.
    const siguiente = SIGUIENTE_ESTADO[order.estadoPedido];
    if (estadoDestino !== siguiente) {
      setError(
        siguiente
          ? `Un pedido solo puede avanzar a "${ESTADO_LABEL[siguiente]}" — no puedes saltarte pasos ni retroceder.`
          : "Este pedido ya está despachado — no puede avanzar más.",
      );
      return;
    }

    setError(null);
    setMovingId(order.id);
    try {
      await avanzarOrder(token, order.id);
      // Recarga "activos"/"entregados hoy" en el padre — si el pedido pasó a
      // DESPACHADO, sale del conjunto de "Activos" (y por lo tanto de este
      // Kanban) igual que ya pasaba en la vista de lista, no queda
      // "aterrizado" visualmente en la columna Despachado.
      onAdvanced();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo avanzar el pedido");
    } finally {
      setMovingId(null);
    }
  }

  return (
    // min-w-0 en ambos niveles — sin esto, un hijo flex (este div dentro del
    // flex-col de page.tsx, y luego la fila de columnas dentro de este) no
    // se encoge por debajo de su ancho de contenido por default, así que la
    // fila de 4 columnas (~1200px) empuja el ancho de todo hasta ahí en vez
    // de quedarse dentro del viewport y dejar que overflow-x-auto scrollee.
    <div className="flex min-w-0 flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex min-w-0 gap-3 overflow-x-auto pb-2">
          {ESTADOS.map((estado) => (
            <KanbanColumn key={estado} estado={estado} orders={porEstado[estado]} movingId={movingId} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function KanbanColumn({
  estado,
  orders,
  movingId,
}: {
  estado: EstadoPedido;
  orders: Order[];
  movingId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: estado });

  return (
    // admin-green a propósito en isOver — excepción documentada del prompt
    // de unificación de tokens (Kanban fuera de alcance, se resuelve en su
    // propio prompt dedicado).
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-[var(--radius-admin-card)] border p-2 transition ${
        isOver ? "border-admin-green bg-admin-bg" : "border-admin-border bg-admin-bg"
      }`}
    >
      <div className="flex items-center justify-between px-1 py-1">
        <span className="text-sm font-bold text-admin-ink">{ESTADO_LABEL[estado]}</span>
        <span className="text-xs font-bold text-admin-ink-soft">{orders.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {orders.length === 0 && (
          <p className="rounded-[var(--radius-admin-control)] border border-dashed border-admin-border p-3 text-center text-xs text-admin-ink-soft">
            Sin pedidos
          </p>
        )}
        {orders.map((order) => (
          <KanbanCard key={order.id} order={order} moving={movingId === order.id} />
        ))}
      </div>
    </div>
  );
}

function KanbanCard({ order, moving }: { order: Order; moving: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: order.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : moving ? 0.6 : 1,
  };

  const fecha = new Date(order.createdAt).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="touch-none">
      <Card padding={12} className="cursor-grab active:cursor-grabbing">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-admin-ink">#{order.folio}</span>
          <span className="text-xs text-admin-ink-soft">{fecha}</span>
        </div>
        <p className="mt-1 truncate text-sm text-admin-ink">{order.clienteNombre}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-admin-ink">${Number(order.total).toFixed(2)}</span>
          {order.estadoPago === "REEMBOLSADO" && (
            <Badge variant={ESTADO_PAGO_VARIANT.REEMBOLSADO!}>{ESTADO_PAGO_LABEL.REEMBOLSADO}</Badge>
          )}
        </div>
      </Card>
    </div>
  );
}
