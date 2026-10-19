import type { ClienteB2bEntregaHistorial, DiaSemanaPedidoB2b, PedidoB2bDetalle, PedidoB2bEstadoEntrega } from "@/lib/api";

/** Una entrega lista para pintar: sus productos ya traen cantidad y precio de lista (el monto es antes del descuento). */
export interface EntregaVista {
  id: string;
  fecha: string;
  dia: DiaSemanaPedidoB2b;
  estado: PedidoB2bEstadoEntrega;
  cerradaAt: string | null;
  atrasada: boolean;
  productos: { productId?: string | null; nombreProducto: string; cantidad: number; precioUnitario: number }[];
}

/** Entregas del panel del pedido: los productos de cada una salen de la distribución por día de los ítems. */
export function entregasDesdePedido(pedido: PedidoB2bDetalle): EntregaVista[] {
  return (pedido.entregas ?? []).map((e) => ({
    id: e.id,
    fecha: e.fecha,
    dia: e.dia,
    estado: e.estado,
    cerradaAt: e.cerradaAt,
    atrasada: e.atrasada,
    productos: pedido.items.flatMap((item) => {
      const d = item.distribucion.find((x) => x.dia === e.dia);
      return d ? [{ productId: item.productId, nombreProducto: item.nombreProducto, cantidad: d.cantidad, precioUnitario: Number(item.precioUnitario) }] : [];
    }),
  }));
}

/** Entregas del historial del cliente (el endpoint ya las trae con sus productos). */
export function entregasDesdeHistorial(entregas: ClienteB2bEntregaHistorial[]): EntregaVista[] {
  return entregas.map((e) => ({
    ...e,
    productos: e.productos.map((p) => ({ nombreProducto: p.nombreProducto, cantidad: p.cantidad, precioUnitario: Number(p.precioUnitario) })),
  }));
}

export const piezasDeEntrega = (e: EntregaVista) => e.productos.reduce((s, p) => s + p.cantidad, 0);
export const montoDeEntrega = (e: EntregaVista) => e.productos.reduce((s, p) => s + p.cantidad * p.precioUnitario, 0);
/** Las canceladas no se cobran: no suman al subtotal. */
export const montoCobrable = (entregas: EntregaVista[]) => entregas.filter((e) => e.estado !== "CANCELADA").reduce((s, e) => s + montoDeEntrega(e), 0);

/**
 * Entrega abierta por defecto: la atrasada (la más antigua) si hay; si no, la próxima pendiente (Pendiente/Lista, por fecha).
 * Si todas están cerradas o canceladas, ninguna.
 */
export function entregaAbiertaPorDefecto(entregas: EntregaVista[]): string | null {
  const porFecha = [...entregas].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const atrasada = porFecha.find((e) => e.atrasada);
  if (atrasada) return atrasada.id;
  return porFecha.find((e) => e.estado === "PENDIENTE" || e.estado === "LISTA")?.id ?? null;
}

/** Resumen por producto de lo que se cobra (entregas no canceladas): producto × cantidad total, con su importe. */
export function resumenPorProducto(entregas: EntregaVista[]): { nombreProducto: string; cantidad: number; monto: number }[] {
  const mapa = new Map<string, { nombreProducto: string; cantidad: number; monto: number }>();
  for (const e of entregas) {
    if (e.estado === "CANCELADA") continue;
    for (const p of e.productos) {
      const fila = mapa.get(p.nombreProducto) ?? { nombreProducto: p.nombreProducto, cantidad: 0, monto: 0 };
      fila.cantidad += p.cantidad;
      fila.monto += p.cantidad * p.precioUnitario;
      mapa.set(p.nombreProducto, fila);
    }
  }
  return [...mapa.values()];
}

/** «Mié 21 oct» — fecha corta sin repetir el día. `fecha` es @db.Date (medianoche UTC): se formatea en UTC. */
export function fechaCorta(iso: string, conDia = true): string {
  const partes = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).formatToParts(new Date(iso));
  const get = (t: string) => (partes.find((p) => p.type === t)?.value ?? "").replace(".", "");
  const dia = get("weekday");
  const base = `${get("day")} ${get("month")}`;
  return conDia ? `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${base}` : base;
}
