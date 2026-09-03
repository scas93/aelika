import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { NotificacionEnvioResultado, NotificacionMensaje, NotificacionProvider } from './notificacion-provider.interface';

// Dominio fijo del lado de Aelika, ya verificado en Resend (Fase C) — cada
// tenant ya NO trae su propio dominio (ver el hallazgo de la Fase B en
// CLAUDE.md sobre verificación de dominio). El valor real verificado en
// Resend se configura vía RESEND_FROM_ADDRESS; este default es solo un
// placeholder legible mientras eso se confirma en .env — ver CLAUDE.md.
const RESEND_FROM_ADDRESS_DEFAULT = 'notificaciones@aelika.com';

/**
 * Envía correos vía Resend. `destinatario` es la dirección de correo del
 * destinatario; `canalConfig.nombreRemitente` (guardado en
 * NotificacionCanalConfig para CORREO, ver schema.prisma) es solo el nombre
 * visible del remitente — el `from` final se arma combinándolo con
 * RESEND_FROM_ADDRESS, el dominio único de Aelika. El tenant nunca elige un
 * dominio propio, así que el bloqueo de verificación de dominio por tenant
 * (hallazgo de la Fase B) queda resuelto: solo hace falta verificar UN
 * dominio, una sola vez, del lado de Aelika.
 */
@Injectable()
export class CorreoProvider implements NotificacionProvider {
  private readonly logger = new Logger(CorreoProvider.name);
  private client?: Resend;

  constructor(private readonly configService: ConfigService) {}

  private getClient(): Resend | null {
    if (this.client) return this.client;
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) return null;
    this.client = new Resend(apiKey);
    return this.client;
  }

  async enviar(
    destinatario: string,
    mensaje: NotificacionMensaje,
    canalConfig: Record<string, unknown>,
  ): Promise<NotificacionEnvioResultado> {
    const client = this.getClient();
    if (!client) {
      return { exito: false, error: 'RESEND_API_KEY no está configurado en este ambiente' };
    }

    const nombreRemitente = canalConfig?.nombreRemitente;
    if (typeof nombreRemitente !== 'string' || !nombreRemitente) {
      return { exito: false, error: 'La configuración del canal de correo no tiene un nombreRemitente válido' };
    }

    const fromAddress = this.configService.get<string>('RESEND_FROM_ADDRESS', RESEND_FROM_ADDRESS_DEFAULT);
    const from = `${nombreRemitente} <${fromAddress}>`;

    try {
      const { error } = await client.emails.send({
        from,
        to: destinatario,
        subject: mensaje.asunto ?? 'Notificación de Aelika',
        text: mensaje.texto,
        html: mensaje.html,
      });

      if (error) {
        this.logger.warn(`Resend rechazó el envío a ${destinatario} desde "${from}": ${error.message}`);
        return { exito: false, error: `Resend: ${error.message}` };
      }

      return { exito: true };
    } catch (error: any) {
      this.logger.error(`Error enviando correo vía Resend a ${destinatario}: ${error?.message ?? error}`);
      return { exito: false, error: `Resend: error inesperado — ${error?.message ?? 'desconocido'}` };
    }
  }
}
