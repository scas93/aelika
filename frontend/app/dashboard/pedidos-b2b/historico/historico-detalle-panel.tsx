"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchPedidoB2b, DIAS_SEMANA_PEDIDO_B2B, type PedidoB2bDetalle } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { ESTADO_COLOR, ESTADO_LABEL } from "../estado";
import SidePanel from "../../_components/SidePanel";
import Badge from "../../_components/Badge";

// Deliberadamente separado de pedidos-b2b/detalle-panel.tsx (el de "Pedidos
// activos", que sí permite editar/confirmar/cancelar) — este panel es de
// solo lectura, sin ninguna acción, ni siquiera oculta tras un rol. Nunca
// importa updatePedidoB2bItems/avanzarPedidoB2b/cancelarPedidoB2b.
export default function HistoricoDetallePanel({
  pedidoId,
  onClose,
}: {
  pedidoId: string | null;
  onClose: () => void;
}) {
  const { token } = useSession();
  const [pedido, setPedido] = useState<PedidoB2bDetalle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!pedidoId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets panel state when the selected pedidoId is cleared
      setPedido(null);
      return;
    }
    setLoadError(null);
    fetchPedidoB2b(token, pedidoId)
      .then(setPedido)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el pedido"));
  }, [pedidoId, token]);

  return (
    <SidePanel open={pedidoId !== null} onClose={onClose} title={pedido ? `Pedido #${pedido.folio}` : "Pedido"}>
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      {!pedido && !loadError && <p className="text-sm text-admin-ink-soft">Cargando...</p>}

      {pedido && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <Badge color={pedido.cancelado ? "bg-red-600 text-white" : ESTADO_COLOR[pedido.estado]}>
              {pedido.cancelado ? "Cancelado" : ESTADO_LABEL[pedido.estado]}
            </Badge>
            <span className="text-sm text-admin-ink-soft">
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

          <div className="flex flex-col gap-3">
            <span className="text-sm font-bold text-admin-ink">Productos</span>
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
        </div>
      )}
    </SidePanel>
  );
}
