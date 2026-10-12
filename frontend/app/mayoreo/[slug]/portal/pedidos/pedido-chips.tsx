import type { ResumenPedidoPortal } from "@/lib/portal-api";
import { claseChipEstado, fechaPago } from "@/lib/portal-pedidos-formato";

const CHIP = "rounded-full px-2.5 py-0.5 text-xs font-semibold";

// Estado, pago y marca «Modificado por el cliente». La marca ya está lista: la enciende el servidor desde la 4f.
export default function PedidoChips({
  pedido,
  conFechaPago = false,
}: {
  pedido: Pick<ResumenPedidoPortal, "estado" | "pago" | "modificadoPorCliente">;
  conFechaPago?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className={`${CHIP} ${claseChipEstado(pedido.estado.codigo)}`}>
        {pedido.estado.etiqueta}
      </span>
      <span
        className={`${CHIP} ${
          pedido.pago.estado === "PAGADO"
            ? "bg-green-50 text-green-800"
            : "bg-mayoreo-accent-soft text-mayoreo-ink"
        }`}
      >
        {pedido.pago.etiqueta}
        {conFechaPago && pedido.pago.pagadoAt
          ? ` · ${fechaPago(pedido.pago.pagadoAt)}`
          : ""}
      </span>
      {pedido.modificadoPorCliente && (
        <span className={`${CHIP} bg-amber-50 text-amber-800`}>
          Modificado por el cliente
        </span>
      )}
    </div>
  );
}
