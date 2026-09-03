import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificacionCanalTipo } from '../../../generated/prisma/enums';
import { TelegramTokenService } from './telegram-token.service';
import type { TelegramUpdate } from './telegram-update.type';

/**
 * Deep link "t.me/<bot>?start=<token>" — Telegram, al abrirlo, manda un
 * mensaje "/start <token>" al bot desde el chat del usuario. El bot no tiene
 * forma de saber a qué tenant pertenece ese click salvo por el token, que
 * TelegramTokenService emitió para ese tenant específico.
 */
@Injectable()
export class TelegramConexionService {
  private readonly logger = new Logger(TelegramConexionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TelegramTokenService,
    private readonly configService: ConfigService,
  ) {}

  async generarLinkConexion(tenantId: string): Promise<{ url: string }> {
    const botUsername = this.configService.getOrThrow<string>('TELEGRAM_BOT_USERNAME');
    const token = await this.tokenService.generar(tenantId);
    return { url: `https://t.me/${botUsername}?start=${token}` };
  }

  /**
   * Punto de entrada del webhook — nunca lanza (un error acá no debe tumbar
   * el endpoint ni hacer que Telegram reintente indefinidamente el mismo
   * update); cualquier caso no manejado simplemente se ignora en silencio
   * del lado de Telegram, pero si hay chat de por medio siempre se le
   * responde algo, nunca se le deja sin respuesta.
   */
  async procesarUpdate(update: TelegramUpdate): Promise<void> {
    const texto = update.message?.text;
    const chatId = update.message?.chat?.id;
    if (!texto || chatId === undefined) {
      return;
    }

    const match = texto.match(/^\/start(?:@\S+)?\s+(\S+)/);
    if (!match) {
      // No es un "/start <token>" — otro mensaje cualquiera al bot, no hay
      // nada que conectar. Se ignora sin responder (no es un error de
      // conexión, es simplemente ruido).
      return;
    }
    const token = match[1];

    const tenantId = await this.tokenService.resolverYConsumir(token);
    if (!tenantId) {
      this.logger.warn(`Token de conexión inválido o vencido recibido en chat_id=${chatId}`);
      await this.responder(
        chatId,
        'Este link de conexión ya no es válido (venció o ya se usó). Genera uno nuevo desde el panel de Aelika e inténtalo de nuevo.',
      );
      return;
    }

    await this.prisma.notificacionCanalConfig.upsert({
      where: { tenantId_tipo: { tenantId, tipo: NotificacionCanalTipo.TELEGRAM } },
      create: { tenantId, tipo: NotificacionCanalTipo.TELEGRAM, conectado: true, config: { chatId: String(chatId) } },
      update: { conectado: true, config: { chatId: String(chatId) } },
    });

    this.logger.log(`Tenant ${tenantId} conectó Telegram (chat_id=${chatId})`);
    await this.responder(chatId, '¡Listo! Tu negocio ya está conectado a las notificaciones de Aelika.');
  }

  private async responder(chatId: number, texto: string): Promise<void> {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN no configurado — no se pudo responder al chat');
      return;
    }
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: texto }),
      });
    } catch (error: any) {
      this.logger.error(`No se pudo responder al chat_id=${chatId}: ${error?.message ?? error}`);
    }
  }
}
