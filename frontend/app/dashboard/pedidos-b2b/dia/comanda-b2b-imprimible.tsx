import type { PedidoB2bEntregaDia, Role } from "@/lib/api";
import { formatearFolioB2b } from "@/lib/format";
import { ROLE_LABEL, formatFechaHora } from "@/lib/thermal-printer";

export interface ComandaB2bImprimibleCtx {
  nombreNegocioTenant: string;
  fechaLabel: string;
  impresoPor: { nombre: string; rol: Role };
}

// Respaldo con window.print() del ticket de entrega (mismos campos y orden que buildComandaB2bDiaBytes en lib/thermal-printer.ts,
// sin precios). El CSS de impresión (globals.css) lo muestra solo cuando se imprime, en ancho de 80 mm.
export default function ComandaB2bImprimible({
  entrega,
  ctx,
  fechaImpresion,
}: {
  entrega: PedidoB2bEntregaDia;
  ctx: ComandaB2bImprimibleCtx;
  fechaImpresion: Date;
}) {
  return (
    <div id="comanda-b2b-imprimible" className="hidden print:block">
      <p className="text-center text-lg font-bold">{ctx.nombreNegocioTenant}</p>
      <p className="text-center text-3xl font-bold">{formatearFolioB2b(entrega.folio)}</p>
      <p className="text-center text-base font-bold">Entrega: {ctx.fechaLabel}</p>
      <hr className="my-2 border-black" />
      <p className="text-xl font-bold">Nombre del negocio: {entrega.negocioNombre}</p>
      <p className="text-sm">Nombre del contacto: {entrega.contactoNombre}</p>
      <p className="text-sm">Teléfono de contacto: {entrega.contactoTelefono}</p>
      <hr className="my-2 border-black" />
      <p className="text-sm">Pedido a preparar:</p>
      <ul className="flex flex-col gap-1">
        {entrega.items.map((item, i) => (
          <li key={`${item.productId ?? item.nombreProducto}-${i}`} className="text-lg font-bold">
            {item.cantidad}x {item.nombreProducto}
          </li>
        ))}
      </ul>
      <hr className="my-2 border-black" />
      <p className="text-sm">
        Impreso por: {ctx.impresoPor.nombre} ({ROLE_LABEL[ctx.impresoPor.rol]})
      </p>
      <p className="text-sm">Fecha de impresión: {formatFechaHora(fechaImpresion)}</p>
    </div>
  );
}
