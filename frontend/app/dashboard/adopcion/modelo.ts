import type { AdopcionClienteFila, AdopcionEstadoSemana, AdopcionEtapa } from "@/lib/api";
import type { BadgeVariant } from "../_components/Badge";

export const ESTADO_LABEL: Record<AdopcionEstadoSemana, string> = {
  PIDIO: "Pidió",
  SIN_CONFIRMAR: "Pedido sin confirmar",
  CANCELADO: "Cancelado",
  NO_HA_PEDIDO_HABITUAL: "No ha pedido (habitual)",
  NO_HA_PEDIDO: "No ha pedido",
};

export const ESTADO_VARIANT: Record<AdopcionEstadoSemana, BadgeVariant> = {
  PIDIO: "exito",
  SIN_CONFIRMAR: "advertencia",
  CANCELADO: "peligro",
  NO_HA_PEDIDO_HABITUAL: "advertencia",
  NO_HA_PEDIDO: "neutro",
};

export const ETAPA_LABEL: Record<AdopcionEtapa, string> = {
  SIN_ACTIVIDAD: "Sin actividad",
  ACCEDIO: "Accedió",
  HIZO_PEDIDO: "Hizo pedido",
  PIDE_CON_REGULARIDAD: "Pide con regularidad",
};

export const ETAPA_VARIANT: Record<AdopcionEtapa, BadgeVariant> = {
  SIN_ACTIVIDAD: "neutro",
  ACCEDIO: "info",
  HIZO_PEDIDO: "info",
  PIDE_CON_REGULARIDAD: "exito",
};

const ORDEN_ESTADO: AdopcionEstadoSemana[] = ["NO_HA_PEDIDO_HABITUAL", "SIN_CONFIRMAR", "CANCELADO", "NO_HA_PEDIDO", "PIDIO"];
const ORDEN_ETAPA: AdopcionEtapa[] = ["SIN_ACTIVIDAD", "ACCEDIO", "HIZO_PEDIDO", "PIDE_CON_REGULARIDAD"];

export type ClaveOrden = "nombre" | "estado" | "etapa" | "ultimoAcceso" | "primerPedido" | "pedidos";
export interface Orden {
  clave: ClaveOrden;
  dir: "asc" | "desc";
}

const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Búsqueda por nombre (sin acentos ni mayúsculas). */
export function filtrarClientes(filas: AdopcionClienteFila[], busqueda: string): AdopcionClienteFila[] {
  const q = norm(busqueda.trim());
  return q ? filas.filter((f) => norm(f.nombre).includes(q)) : filas;
}

/**
 * Orden por columna. Sin orden elegido se conserva el del servidor (los «habituales que no han pedido» primero).
 * Los vacíos («Sin registro», sin primer pedido) van siempre al final.
 */
export function ordenarClientes(filas: AdopcionClienteFila[], orden: Orden | null): AdopcionClienteFila[] {
  if (!orden) return filas;
  const signo = orden.dir === "asc" ? 1 : -1;
  const valor = (f: AdopcionClienteFila): string | number | null => {
    switch (orden.clave) {
      case "nombre":
        return norm(f.nombre);
      case "estado":
        return ORDEN_ESTADO.indexOf(f.estado);
      case "etapa":
        return ORDEN_ETAPA.indexOf(f.etapa);
      case "ultimoAcceso":
        return f.ultimoAccesoAt;
      case "primerPedido":
        return f.primerPedidoAt;
      case "pedidos":
        return f.pedidosUltimas4Semanas;
    }
  };
  return [...filas].sort((a, b) => {
    const va = valor(a);
    const vb = valor(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return va < vb ? -signo : va > vb ? signo : 0;
  });
}

const ZONA = "America/Mexico_City";

export function formatoFechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: ZONA }).format(new Date(iso));
}

export function formatoFecha(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: ZONA }).format(new Date(iso));
}

/** Fecha de calendario "YYYY-MM-DD" (sin hora) — se formatea en UTC para no correrla de día. */
export function formatoDia(ymd: string): string {
  return new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${ymd}T00:00:00.000Z`),
  );
}

/** 5 → "5 h"; 30 → "1 d 6 h"; 24 → "1 d". */
export function formatoHoras(horas: number): string {
  if (horas < 24) return `${horas} h`;
  const d = Math.floor(horas / 24);
  const h = Math.round(horas - d * 24);
  return h ? `${d} d ${h} h` : `${d} d`;
}

export function desplazarSemana(lunes: string, semanas: number): string {
  const d = new Date(`${lunes}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + semanas * 7);
  return d.toISOString().slice(0, 10);
}
