import { EstadoPedido } from '../../generated/prisma/enums';

/**
 * Los estados que un pedido B2C puede tener. `EstadoPedido` es compartido con B2B, que además usa EN_PROCESO y COMPLETADO
 * (calculados de las entregas): B2C nunca los tiene, así que ni sus filtros, ni sus resúmenes, ni las reglas ORDER deben
 * listarlos ni aceptarlos. Todo lo B2C que antes recorría `Object.values(EstadoPedido)` usa esta lista.
 */
export const ESTADOS_B2C: EstadoPedido[] = [
  EstadoPedido.PENDIENTE_CONFIRMACION,
  EstadoPedido.CONFIRMADO_SURTIENDO,
  EstadoPedido.LISTO_ENTREGA,
  EstadoPedido.DESPACHADO,
];
