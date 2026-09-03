import { NotificacionEvento } from '../../../generated/prisma/enums';
import type { NotificacionMensaje } from '../providers/notificacion-provider.interface';

/**
 * Payload del job de notificación. Fase D: el destinatario de la audiencia
 * NEGOCIO se resuelve DENTRO del worker, directamente desde
 * NotificacionCanalConfig.config del canal que matchee (chatId de Telegram,
 * correoDestino de Correo) — es tenant-level, el worker ya lo tiene a la
 * mano vía el include de la query. La audiencia CLIENTE es la única que
 * necesita venir explícita en el job: es por-pedido (el correo de quien
 * hizo ESE pedido específico), algo que solo quien encola el job conoce.
 * Ver NotificacionesProcessor.
 */
export interface NotificacionJobData {
  tenantId: string;
  evento: NotificacionEvento;
  mensaje: NotificacionMensaje;
  // Correo del cliente que originó el pedido — puede faltar (ver hallazgo
  // en CLAUDE.md sobre Order sin campo de correo consistente); si falta, el
  // worker omite cualquier fila de audiencia CLIENTE con un log, no falla
  // el job por eso.
  destinatarioCliente?: string;
}

export const NOTIFICACION_JOB_DESPACHAR = 'despachar';
