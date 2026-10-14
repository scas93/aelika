"use client";

import DetallePanel from "../detalle-panel";

// Históricos usa el MISMO panel lateral que Pedidos activos (antes era uno aparte, de solo lectura). Qué acciones ofrece
// ya lo decide el estado del pedido y el rol, no la pantalla:
//  · Gerente/Dueño: marcar / desmarcar pagado en cualquier estado (incluso Cancelado), corregir entregas ya cerradas, y
//    "Editar" en un pedido Completado (agregar entregas lo regresa a En proceso y a Pedidos activos).
//  · Un pedido Cancelado solo permite las acciones de pago y la corrección de sus entregas cerradas (no se edita).
//  · Operador: solo lectura (las acciones de escritura son de admin).
export default function HistoricoDetallePanel({
  pedidoId,
  onClose,
  onChanged,
}: {
  pedidoId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  return <DetallePanel pedidoId={pedidoId} onClose={onClose} onChanged={onChanged} />;
}
