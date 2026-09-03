import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificacionEnvioResultado, NotificacionMensaje, NotificacionProvider } from './notificacion-provider.interface';

/**
 * Envía mensajes vía la Bot API de Telegram (https://api.telegram.org/bot<token>/sendMessage)
 * usando `fetch` nativo — no hace falta una librería de cliente para una sola
 * llamada HTTP.
 *
 * IMPORTANTE (hallazgo, ver CLAUDE.md): este bot token es uno NUEVO y
 * dedicado a notificaciones, no el bot conversacional que ya usan los
 * negocios — ese vive dentro de Botpress (credenciales de canal
 * configuradas a mano ahí, ver la sección de arquitectura multi-tenant) y no
 * está expuesto en ningún lugar de este backend para reutilizar. `chatId`
 * (guardado en NotificacionCanalConfig.config para TELEGRAM) es el ID del
 * chat de Telegram al que este bot *dedicado* le manda el aviso — el tenant
 * tiene que iniciar una conversación con este bot nuevo para obtener ese
 * chat ID, es un bot aparte del bot de atención al cliente.
 */
@Injectable()
export class TelegramProvider implements NotificacionProvider {
  private readonly logger = new Logger(TelegramProvider.name);

  constructor(private readonly configService: ConfigService) {}

  async enviar(destinatario: string, mensaje: NotificacionMensaje): Promise<NotificacionEnvioResultado> {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      return { exito: false, error: 'TELEGRAM_BOT_TOKEN no está configurado en este ambiente' };
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: destinatario, text: mensaje.texto }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.ok) {
        const detalle = body?.description ?? `HTTP ${response.status}`;
        this.logger.warn(`Telegram rechazó el envío a chat_id=${destinatario}: ${detalle}`);
        return { exito: false, error: `Telegram: ${detalle}` };
      }

      return { exito: true };
    } catch (error: any) {
      this.logger.error(`Error de red enviando a Telegram (chat_id=${destinatario}): ${error?.message ?? error}`);
      return { exito: false, error: `Telegram: error de red — ${error?.message ?? 'desconocido'}` };
    }
  }
}
