import { EstadoPago } from '../../generated/prisma/enums';

/**
 * Agrupación de `EstadoPago` para lo que ve el negocio (panel, histórico, CSV).
 * Un pedido TARJETA en PENDIENTE/PROCESANDO/FALLIDO es un intento de pago, no un
 * pedido: se muestra como "Pago no completado" sin distinguir entre los tres.
 * Los 5 valores crudos siguen siendo la fuente de verdad en la base de datos.
 */
export const GRUPOS_ESTADO_PAGO = ['PAGADO', 'NO_COMPLETADO', 'REEMBOLSADO'] as const;
export type GrupoEstadoPago = (typeof GRUPOS_ESTADO_PAGO)[number];

export const ESTADOS_POR_GRUPO: Record<GrupoEstadoPago, EstadoPago[]> = {
  PAGADO: [EstadoPago.PAGADO],
  NO_COMPLETADO: [EstadoPago.PENDIENTE, EstadoPago.PROCESANDO, EstadoPago.FALLIDO],
  REEMBOLSADO: [EstadoPago.REEMBOLSADO],
};

export const ETIQUETA_GRUPO_ESTADO_PAGO: Record<GrupoEstadoPago, string> = {
  PAGADO: 'Pagado',
  NO_COMPLETADO: 'Pago no completado',
  REEMBOLSADO: 'Reembolsado',
};

/** Estados que el panel activo considera pedidos reales: pagados + reembolsados (con su badge). */
export const ESTADOS_PANEL_ACTIVO: EstadoPago[] = [EstadoPago.PAGADO, EstadoPago.REEMBOLSADO];

export function grupoDeEstadoPago(estado: EstadoPago): GrupoEstadoPago {
  if (estado === EstadoPago.PAGADO) return 'PAGADO';
  if (estado === EstadoPago.REEMBOLSADO) return 'REEMBOLSADO';
  return 'NO_COMPLETADO';
}
