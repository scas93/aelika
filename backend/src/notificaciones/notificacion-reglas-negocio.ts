import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { NotificacionAudiencia, NotificacionCanalTipo, NotificacionEvento, TipoStorefront } from '../../generated/prisma/enums';

/** Único evento de mayoreo. El resto de `NotificacionEvento` es de menudeo. */
export const EVENTO_MAYOREO = NotificacionEvento.PEDIDO_MODIFICADO_CLIENTE;
/** Único canal que usa mayoreo. */
export const CANAL_MAYOREO = NotificacionCanalTipo.WHATSAPP;

export const esMayoreo = (tipo: TipoStorefront) => tipo === TipoStorefront.RETAIL_B2B;

/** Un canal de este tipo solo existe en mayoreo (WHATSAPP) o solo fuera de él (el resto). 403 si no corresponde al negocio. */
export function exigirCanalPermitido(tipoNegocio: TipoStorefront, canal: NotificacionCanalTipo) {
  const mayoreo = esMayoreo(tipoNegocio);
  if (canal === CANAL_MAYOREO && !mayoreo) {
    throw new ForbiddenException('El canal de WhatsApp solo está disponible para negocios de mayoreo');
  }
  if (canal !== CANAL_MAYOREO && mayoreo) {
    throw new ForbiddenException('Los negocios de mayoreo solo usan el canal de WhatsApp');
  }
}

/** 403 si el evento no corresponde al tipo de negocio; 400 si la combinación evento + audiencia + canal no es válida. */
export function exigirEventoPermitido(
  tipoNegocio: TipoStorefront,
  evento: NotificacionEvento,
  audiencia: NotificacionAudiencia,
  canal: NotificacionCanalTipo,
) {
  const mayoreo = esMayoreo(tipoNegocio);
  const esEventoMayoreo = evento === EVENTO_MAYOREO;
  if (esEventoMayoreo && !mayoreo) {
    throw new ForbiddenException('El evento «Pedido modificado por el cliente» solo está disponible para negocios de mayoreo');
  }
  if (!esEventoMayoreo && mayoreo) {
    throw new ForbiddenException('Los negocios de mayoreo no usan los eventos de menudeo');
  }
  if (esEventoMayoreo && audiencia !== NotificacionAudiencia.NEGOCIO) {
    throw new BadRequestException('Este evento solo avisa al negocio');
  }
  if (esEventoMayoreo !== (canal === CANAL_MAYOREO)) {
    throw new BadRequestException(
      esEventoMayoreo
        ? 'Este evento solo puede avisar por WhatsApp'
        : 'El canal de WhatsApp solo puede usarse con el evento «Pedido modificado por el cliente»',
    );
  }
}
