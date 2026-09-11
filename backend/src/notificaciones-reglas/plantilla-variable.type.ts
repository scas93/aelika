import { ReglaPlantillaVariableFuente } from '../../generated/prisma/enums';

/**
 * Forma de un elemento de `Regla.plantillaVariables` (ver comentario del
 * campo en schema.prisma). Sin DTO/class-validator todavía — mismo motivo
 * que FiltroCondicion (Etapa 1): esta etapa no expone ningún endpoint que
 * lo reciba desde afuera, solo lo consume ReglaEnvioService.
 */
export interface PlantillaVariable {
  posicion: number;
  fuente: ReglaPlantillaVariableFuente;
  valor: string;
}

/** Único campo de Cliente soportado como CAMPO_CLIENTE en esta etapa. */
export const CAMPO_CLIENTE_SOPORTADO = 'nombre' as const;

/** Único campo de pedido soportado como CAMPO_PEDIDO en esta etapa (Etapa 2c). */
export const CAMPO_PEDIDO_SOPORTADO = 'folio' as const;

// NOMBRE_NEGOCIO no tiene nada real que elegir (siempre resuelve
// Tenant.nombre) — este placeholder existe solo por simetría con
// CAMPO_CLIENTE_SOPORTADO/CAMPO_PEDIDO_SOPORTADO, para no dejar el campo
// `valor` vacío sin motivo. Ver ReglaEnvioService.resolverVariables.
export const NOMBRE_NEGOCIO_SOPORTADO = 'nombre' as const;

/**
 * Datos del pedido que disparó el envío — solo lo aplica ReglaEventoPedidoService
 * (trigger EVENTO_PEDIDO). Se pasa explícito a ReglaEnvioService.enviar en vez
 * de que el servicio vuelva a consultar el pedido por su cuenta, porque eso lo
 * obligaría a saber si viene de Order o PedidoB2b — mezclando responsabilidades
 * que hoy no tiene.
 */
export interface PedidoContexto {
  folio: string;
}
