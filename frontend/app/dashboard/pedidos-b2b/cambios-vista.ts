import type { PedidoB2bCambios, PedidoB2bCambiosRespuesta, PedidoB2bEntregaCambio, PedidoB2bLineaCambio } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { fechaCorta } from "./entregas-vista";

/** Texto de cuando el aviso existe pero no hay referencia (marca anterior a esta función). */
export const TEXTO_SIN_DETALLE = "No hay detalle de esta modificación: el pedido se modificó antes de que el panel guardara qué cambió.";
export const TEXTO_SIN_DIFERENCIAS = "Sin diferencias frente a la última revisión";
export const TEXTO_SOLO_PRECIOS = "El total cambió por actualización de precios";

const corta = (fecha: string) => fechaCorta(fecha).toLowerCase();
const piezas = (n: number) => `${n} ${n === 1 ? "pieza" : "piezas"}`;

/** Clave de una línea entre referencia y pedido actual (igual que el servidor: productId, o el nombre si ya no existe). */
export const claveLinea = (l: { productId?: string | null; nombreProducto: string }) => l.productId ?? `nombre:${l.nombreProducto}`;

export function textoLinea(l: PedidoB2bLineaCambio): string {
  if (l.tipo === "NUEVO") return `${l.nombreProducto}: nuevo (${l.despues})`;
  if (l.tipo === "ELIMINADO") return `${l.nombreProducto}: eliminado`;
  return `${l.nombreProducto}: ${l.antes} → ${l.despues} piezas`;
}

/** Etiqueta corta de una línea para la lista de entregas: «Nuevo», «Cambió 4 → 6», «Eliminado». */
export function etiquetaLinea(l: PedidoB2bLineaCambio): string {
  if (l.tipo === "NUEVO") return "Nuevo";
  if (l.tipo === "ELIMINADO") return "Eliminado";
  return `Cambió ${l.antes} → ${l.despues}`;
}

/** Lista breve en lenguaje simple, ordenada por fecha de entrega (la nota y el total al final). */
export function textosCambios(c: PedidoB2bCambios): string[] {
  const out: string[] = [];
  for (const e of c.entregas) {
    if (e.tipo === "NUEVA") out.push(`Entrega nueva: ${corta(e.fecha)} (${piezas(e.piezas)})`);
    else if (e.tipo === "ELIMINADA") out.push(`Entrega eliminada: ${corta(e.fecha)}`);
    else if (e.tipo === "MOVIDA") out.push(`Entrega movida de ${corta(e.fechaAnterior!)} a ${corta(e.fecha)} (${piezas(e.piezas)})`);
    else for (const l of e.lineas) out.push(`${fechaCorta(e.fecha)} · ${textoLinea(l)}`);
  }
  if (c.nota) out.push(`Nota del cliente: ${{ NUEVA: "nueva", MODIFICADA: "modificada", QUITADA: "quitada" }[c.nota]}`);
  if (c.total) {
    const montos = `${formatMoney(c.total.antes)} → ${formatMoney(c.total.despues)}`;
    out.push(c.soloPrecios ? `${TEXTO_SOLO_PRECIOS} (${montos})` : `Total: ${montos}`);
  }
  return out;
}

/** Qué decir bajo el aviso según la respuesta del servidor; null = no mostrar la sección. */
export function contenidoSeccion(r: PedidoB2bCambiosRespuesta | null): { textos: string[]; sinDetalle: boolean } | null {
  if (!r || r.estado === "NINGUNO") return null;
  if (r.estado === "SIN_DETALLE") return { textos: [TEXTO_SIN_DETALLE], sinDetalle: true };
  if (r.estado === "SIN_DIFERENCIAS" || !r.cambios) return { textos: [TEXTO_SIN_DIFERENCIAS], sinDetalle: false };
  return { textos: textosCambios(r.cambios), sinDetalle: false };
}

/** Cambios por fecha para marcar la lista de entregas (las MODIFICADA, NUEVA y MOVIDA existen en el pedido; las ELIMINADA no). */
export function cambiosPorFecha(c: PedidoB2bCambios | null | undefined): Map<string, PedidoB2bEntregaCambio> {
  return new Map((c?.entregas ?? []).map((e) => [e.fecha, e]));
}
