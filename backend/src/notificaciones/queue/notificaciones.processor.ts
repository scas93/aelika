import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificacionAudiencia, NotificacionCanalTipo } from '../../../generated/prisma/enums';
import { NotificacionProvidersRegistry } from '../providers/notificacion-providers.registry';
import { NOTIFICACIONES_QUEUE } from './notificaciones-queue.constants';
import { NotificacionJobData } from './notificacion-job.type';

/**
 * Fase D: dispatch real con destinatario resuelto por audiencia+canal. Para
 * el (tenantId, evento) del job, busca todas las filas de
 * NotificacionEventoConfig activas cuyo canal también esté activo, y por
 * cada una despacha al proveedor correspondiente.
 *
 * Usa PrismaService directo (no TenantPrismaService): un worker de BullMQ no
 * corre dentro de un request HTTP con sesión — no hay tenantId de JWT del
 * que depender. El tenantId viene del job y se usa explícitamente en cada
 * where, mismo principio de aislamiento que PublicService (fuente del
 * tenantId distinta, mismo filtro).
 */
@Processor(NOTIFICACIONES_QUEUE)
export class NotificacionesProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificacionesProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: NotificacionProvidersRegistry,
  ) {
    super();
  }

  async process(job: Job<NotificacionJobData>): Promise<void> {
    const { tenantId, evento, mensaje, destinatarioCliente } = job.data;

    const configs = await this.prisma.notificacionEventoConfig.findMany({
      where: { tenantId, evento, activo: true, canalConfig: { activo: true } },
      include: { canalConfig: true },
    });

    if (configs.length === 0) {
      this.logger.log(
        `Job ${job.id}: sin canales configurados/activos para tenant=${tenantId} evento=${evento} — se omite, no es un error.`,
      );
      return;
    }

    const errores: string[] = [];

    for (const config of configs) {
      const canalConfigJson = config.canalConfig.config as Record<string, unknown>;
      const destinatario = this.resolverDestinatario(config.audiencia, config.canalConfig.tipo, canalConfigJson, destinatarioCliente);

      if (destinatario === 'no-viable') {
        this.logger.log(
          `Job ${job.id}: audiencia=${config.audiencia} + canal=${config.canalConfig.tipo} no es una combinación viable (sin mecanismo para resolver ese destinatario) — se omite, no es un error.`,
        );
        continue;
      }

      if (!destinatario) {
        this.logger.log(
          `Job ${job.id}: sin destinatario para audiencia=${config.audiencia} (canal=${config.canalConfig.tipo}) — canal no conectado/sin dato disponible, se omite.`,
        );
        continue;
      }

      const provider = this.providers.get(config.canalConfig.tipo);
      if (!provider) {
        const msg = `Sin proveedor implementado para el canal ${config.canalConfig.tipo} (audiencia=${config.audiencia})`;
        this.logger.warn(`Job ${job.id}: ${msg}`);
        errores.push(msg);
        continue;
      }

      const resultado = await provider.enviar(destinatario, mensaje, canalConfigJson);
      if (!resultado.exito) {
        const msg = `Falló el envío por ${config.canalConfig.tipo} a audiencia=${config.audiencia} (destinatario=${destinatario}): ${resultado.error}`;
        this.logger.error(`Job ${job.id}: ${msg}`);
        errores.push(msg);
      } else {
        this.logger.log(`Job ${job.id}: envío exitoso por ${config.canalConfig.tipo} a audiencia=${config.audiencia}`);
      }
    }

    // Cualquier fallo hace que BullMQ marque el job completo como failed
    // (visible en la cola) — no hay reintentos automáticos configurados en
    // esta fase (ver alcance), así que un canal que sí tuvo éxito antes del
    // que falló no se reintenta ni se deshace, solo se reporta.
    if (errores.length > 0) {
      throw new Error(errores.join(' | '));
    }
  }

  /**
   * NEGOCIO se resuelve del propio canalConfig (dato tenant-level, ya
   * cargado): chatId de Telegram, correoDestino de Correo. CLIENTE viene
   * del job (dato por-pedido) — salvo CLIENTE+TELEGRAM, que no es viable
   * con el modelo de conexión actual (el link de conexión es por tenant, no
   * hay forma de que un cliente final tenga un chat propio conectado) y se
   * marca explícitamente como "no-viable" para que el caller lo distinga de
   * "configurado pero sin dato todavía".
   */
  private resolverDestinatario(
    audiencia: NotificacionAudiencia,
    canalTipo: NotificacionCanalTipo,
    canalConfigJson: Record<string, unknown>,
    destinatarioCliente: string | undefined,
  ): string | undefined | 'no-viable' {
    if (audiencia === NotificacionAudiencia.NEGOCIO) {
      if (canalTipo === NotificacionCanalTipo.TELEGRAM) {
        const chatId = canalConfigJson.chatId;
        return typeof chatId === 'string' && chatId ? chatId : undefined;
      }
      if (canalTipo === NotificacionCanalTipo.CORREO) {
        const correoDestino = canalConfigJson.correoDestino;
        return typeof correoDestino === 'string' && correoDestino ? correoDestino : undefined;
      }
      return undefined;
    }

    // audiencia === CLIENTE
    if (canalTipo === NotificacionCanalTipo.TELEGRAM) {
      return 'no-viable';
    }
    return destinatarioCliente;
  }
}
