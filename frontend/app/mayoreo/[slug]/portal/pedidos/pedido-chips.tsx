import type { ResumenPedidoPortal } from "@/lib/portal-api";
import { claseChipEstado } from "@/lib/portal-pedidos-formato";

const CHIP = "rounded-full px-2.5 py-0.5 text-xs font-semibold";

// Solo el estado del pedido. El portal no muestra pago ni la marca «Modificado por el cliente» (eso es del negocio).
export default function PedidoChips({
  pedido,
}: {
  pedido: Pick<ResumenPedidoPortal, "estado">;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className={`${CHIP} ${claseChipEstado(pedido.estado.codigo)}`}>
        {pedido.estado.etiqueta}
      </span>
    </div>
  );
}
