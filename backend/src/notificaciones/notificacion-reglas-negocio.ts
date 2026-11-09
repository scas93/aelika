import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  NotificacionAudiencia,
  NotificacionCanalTipo,
  NotificacionEvento,
  TipoStorefront,
} from '../../generated/prisma/enums';

/** Eventos que solo existen en mayoreo. El resto de `NotificacionEvento` es de menudeo. */
export const EVENTOS_MAYOREO: NotificacionEvento[] = [
  NotificacionEvento.PEDIDO_MODIFICADO_CLIENTE,
  NotificacionEvento.RESUMEN_SEMANAL,
];
/** Canales que usa mayoreo. */
export const CANALES_MAYOREO: NotificacionCanalTipo[] = [
  NotificacionCanalTipo.WHATSAPP,
  NotificacionCanalTipo.CORREO,
];

/** Canal con el que se combina cada evento de mayoreo (uno a uno, en las dos direcciones). */
const CANAL_DEL_EVENTO: Partial<
  Record<NotificacionEvento, NotificacionCanalTipo>
> = {
  [NotificacionEvento.PEDIDO_MODIFICADO_CLIENTE]:
    NotificacionCanalTipo.WHATSAPP,
  [NotificacionEvento.RESUMEN_SEMANAL]: NotificacionCanalTipo.CORREO,
};
const NOMBRE_EVENTO: Partial<Record<NotificacionEvento, string>> = {
  [NotificacionEvento.PEDIDO_MODIFICADO_CLIENTE]:
    'Pedido modificado por el cliente',
  [NotificacionEvento.RESUMEN_SEMANAL]: 'Resumen semanal',
};
const NOMBRE_CANAL: Partial<Record<NotificacionCanalTipo, string>> = {
  [NotificacionCanalTipo.WHATSAPP]: 'WhatsApp',
  [NotificacionCanalTipo.CORREO]: 'Correo',
};

export const esMayoreo = (tipo: TipoStorefront) =>
  tipo === TipoStorefront.RETAIL_B2B;
export const esEventoMayoreo = (evento: NotificacionEvento) =>
  EVENTOS_MAYOREO.includes(evento);
export const esCanalMayoreo = (canal: NotificacionCanalTipo) =>
  CANALES_MAYOREO.includes(canal);

/**
 * WHATSAPP solo existe en mayoreo. En mayoreo solo existen WHATSAPP y CORREO (este último con la lista de direcciones del resumen
 * semanal); los demás canales y el WhatsApp fuera de mayoreo → 403. El CORREO de menudeo y hotel no cambia.
 */
export function exigirCanalPermitido(
  tipoNegocio: TipoStorefront,
  canal: NotificacionCanalTipo,
) {
  const mayoreo = esMayoreo(tipoNegocio);
  if (canal === NotificacionCanalTipo.WHATSAPP && !mayoreo) {
    throw new ForbiddenException(
      'El canal de WhatsApp solo está disponible para negocios de mayoreo',
    );
  }
  if (mayoreo && !esCanalMayoreo(canal)) {
    throw new ForbiddenException(
      'Los negocios de mayoreo solo usan los canales de WhatsApp y Correo',
    );
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
  const eventoDeMayoreo = esEventoMayoreo(evento);
  if (eventoDeMayoreo && !mayoreo) {
    throw new ForbiddenException(
      `El evento «${NOMBRE_EVENTO[evento]}» solo está disponible para negocios de mayoreo`,
    );
  }
  if (!eventoDeMayoreo && mayoreo) {
    throw new ForbiddenException(
      'Los negocios de mayoreo no usan los eventos de menudeo',
    );
  }
  if (eventoDeMayoreo) {
    // El resumen semanal tiene dos audiencias: NEGOCIO (su equipo) y CLIENTE (cada cliente B2B, a su correo propio). Es la única
    // excepción a «la audiencia CLIENTE está bloqueada en mayoreo»; el resto de eventos solo avisa al negocio.
    const audienciasPermitidas =
      evento === NotificacionEvento.RESUMEN_SEMANAL
        ? [NotificacionAudiencia.NEGOCIO, NotificacionAudiencia.CLIENTE]
        : [NotificacionAudiencia.NEGOCIO];
    if (!audienciasPermitidas.includes(audiencia)) {
      throw new BadRequestException('Este evento solo avisa al negocio');
    }
    const canalEsperado = CANAL_DEL_EVENTO[evento]!;
    if (canal !== canalEsperado) {
      throw new BadRequestException(
        `Este evento solo puede avisar por ${NOMBRE_CANAL[canalEsperado]}`,
      );
    }
    return;
  }
  if (canal === NotificacionCanalTipo.WHATSAPP) {
    throw new BadRequestException(
      'El canal de WhatsApp solo puede usarse con el evento «Pedido modificado por el cliente»',
    );
  }
}
