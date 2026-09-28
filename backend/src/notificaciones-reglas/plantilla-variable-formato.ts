import { EstadoPedido, MetodoEntrega, MetodoPago, PedidoB2bEstado } from '../../generated/prisma/enums';

// Mismo timezone hardcodeado que backend/src/common/horario.ts — todos los
// tenants piloto operan en America/Mexico_City.
const TIMEZONE = 'America/Mexico_City';
const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

const MONEY_FORMATTER = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const FECHA_LARGA_FORMATTER = new Intl.DateTimeFormat('es-MX', { timeZone: TIMEZONE, day: 'numeric', month: 'long' });
const FECHA_CORTA_FORMATTER = new Intl.DateTimeFormat('es-MX', { timeZone: TIMEZONE, day: 'numeric', month: 'short' });
const HORA_FORMATTER = new Intl.DateTimeFormat('es-MX', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const MES_ANIO_FORMATTER = new Intl.DateTimeFormat('es-MX', { timeZone: TIMEZONE, month: 'long', year: 'numeric' });

/** "$1,245.50" — desde Decimal (nunca Float), ver CLAUDE.md. */
export function formatDinero(valor: unknown): string {
  return MONEY_FORMATTER.format(Number(valor));
}

/** "12 de septiembre". */
export function formatFechaLarga(fecha: Date): string {
  return FECHA_LARGA_FORMATTER.format(fecha);
}

/** "24 sep, 12:30". */
export function formatFechaHoraCorta(fecha: Date): string {
  return `${FECHA_CORTA_FORMATTER.format(fecha)}, ${HORA_FORMATTER.format(fecha)}`;
}

/** "marzo de 2026". */
export function formatMesAnio(fecha: Date): string {
  return MES_ANIO_FORMATTER.format(fecha);
}

/**
 * Tiempo transcurrido simple (ms / 24h) — mismo criterio que
 * ReglasFiltroService.filtroAntiguedad, no días naturales/calendario ni
 * depende de timezone.
 */
export function diasDesde(fecha: Date, ahora: Date): number {
  return Math.max(0, Math.floor((ahora.getTime() - fecha.getTime()) / MILISEGUNDOS_POR_DIA));
}

export const ESTADO_PEDIDO_LABEL: Record<EstadoPedido, string> = {
  PENDIENTE_CONFIRMACION: 'Pendiente de confirmación',
  CONFIRMADO_SURTIENDO: 'Confirmado y surtiendo',
  LISTO_ENTREGA: 'Listo para entrega',
  DESPACHADO: 'Despachado',
};

export const PEDIDO_B2B_ESTADO_LABEL: Record<PedidoB2bEstado, string> = {
  PENDIENTE_CONFIRMACION: 'Pendiente de confirmación',
  CONFIRMADO_SURTIENDO: 'Confirmado y surtiendo',
  DESPACHADO: 'Despachado',
};

export const METODO_ENTREGA_LABEL: Record<MetodoEntrega, string> = {
  RECOGER: 'Recoger en tienda',
  DOMICILIO: 'Envío a domicilio',
};

export const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta',
};

export interface ItemParaResumen {
  nombreProducto: string;
  cantidad: number;
}

const MAX_PRODUCTOS_EN_RESUMEN = 3;

/** "2x Concha, 1x Café americano y 3 más". */
export function resumenProductos(items: ItemParaResumen[]): string {
  if (items.length === 0) return '';
  const visibles = items
    .slice(0, MAX_PRODUCTOS_EN_RESUMEN)
    .map((item) => `${item.cantidad}x ${item.nombreProducto}`)
    .join(', ');
  const restantes = items.length - MAX_PRODUCTOS_EN_RESUMEN;
  return restantes > 0 ? `${visibles} y ${restantes} más` : visibles;
}

/**
 * Restricciones de Meta para TODO valor resuelto de una variable de
 * plantilla, incluido VALOR_FIJO (ver ReglaEnvioService.resolverVariables):
 * nunca vacío (cae al `fallback` de la variable), sin saltos de línea/tabs,
 * sin más de 4 espacios seguidos.
 */
export function sanitizarParaMeta(valor: string, fallback: string): string {
  const sinSaltos = valor.replace(/[\r\n\t]+/g, ' ');
  const espaciosControlados = sinSaltos.replace(/ {5,}/g, '    ');
  const limpio = espaciosControlados.trim();
  return limpio === '' ? fallback : limpio;
}
