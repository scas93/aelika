import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { NOTIFICACIONES_QUEUE } from './notificaciones-queue.constants';
import { NOTIFICACION_JOB_DESPACHAR, NotificacionJobData } from './notificacion-job.type';

/**
 * Productor de la cola de notificaciones.
 */
@Injectable()
export class NotificacionesQueueService {
  private readonly logger = new Logger(NotificacionesQueueService.name);

  constructor(@InjectQueue(NOTIFICACIONES_QUEUE) private readonly queue: Queue<NotificacionJobData>) {}

  encolar(data: NotificacionJobData) {
    return this.queue.add(NOTIFICACION_JOB_DESPACHAR, data);
  }

  /**
   * Variante best-effort para los triggers del ciclo de vida del pedido
   * (creación, avanzar, webhook de Stripe — Fase D): encolar una
   * notificación NUNCA debe bloquear ni hacer fallar esas operaciones. Si
   * falla (ej. Redis caído), se loguea y se sigue — el llamador nunca ve la
   * excepción, y deliberadamente no se espera con `await` en el caller
   * (esta promesa nunca rechaza) para que tampoco lo bloquee mientras
   * Redis reintenta conectar.
   */
  async encolarSeguro(data: NotificacionJobData): Promise<void> {
    try {
      await this.encolar(data);
    } catch (error: any) {
      this.logger.error(
        `No se pudo encolar notificación (tenant=${data.tenantId}, evento=${data.evento}): ${error?.message ?? error}`,
      );
    }
  }
}
