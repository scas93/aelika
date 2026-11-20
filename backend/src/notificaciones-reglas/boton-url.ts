import { BadRequestException } from '@nestjs/common';
import type { PedidoContexto } from './plantilla-variable.type';

/**
 * Marcador que, guardado en `Regla.botonUrlValor` de una regla RESERVA_AUTOMATICA, hace que el valor del botón de URL dinámica
 * sea el número de reserva (folio del PMS) de CADA reserva, en vez de un texto fijo. Cualquier otro valor es el texto fijo de
 * siempre. Se guarda en la misma columna a propósito (sin migración): el panel no la toca en reglas de reservas.
 */
export const BOTON_URL_FOLIO_RESERVA = '{numeroReserva}';

/** Mismo tope que el valor fijo (validarBotonUrlValor): la parte variable de la URL de Meta. */
export const BOTON_URL_MAX = 200;

/**
 * Valor del botón para UN envío. Texto fijo → tal cual (sin tocarlo, idéntico a antes). Marcador de folio → folio de la reserva
 * codificado para URL (`encodeURIComponent`); si no hay reserva de contexto o el folio queda vacío o demasiado largo lanza
 * BadRequestException, y el llamador (que lo invoca ANTES de crear el registro) no envía ni deja registro.
 */
export function resolverBotonUrlValor(valor: string, contexto: PedidoContexto | undefined): string {
  if (valor !== BOTON_URL_FOLIO_RESERVA) return valor;
  if (contexto?.origen !== 'RESERVA') {
    throw new BadRequestException('El botón con número de reserva solo aplica a envíos de reservas de hotel.');
  }
  const folio = (contexto.folio ?? '').trim();
  if (folio === '') throw new BadRequestException('La reserva no tiene número de reserva para el botón de URL.');
  const codificado = encodeURIComponent(folio);
  if (codificado.length > BOTON_URL_MAX) {
    throw new BadRequestException('El número de reserva codificado es demasiado largo para el botón de URL.');
  }
  return codificado;
}
