import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * El endpoint del webhook (`POST /notificaciones/telegram/webhook`) es
 * @Public() — Telegram lo llama sin JWT — así que necesita su propia
 * verificación, mismo principio que BotAuthGuard para /internal/bot-config.
 * Telegram soporta mandar un `secret_token` fijo en cada request al
 * registrar el webhook (parámetro `secret_token` de setWebhook), reenviado
 * en el header `X-Telegram-Bot-Api-Secret-Token` — lo comparamos contra
 * TELEGRAM_WEBHOOK_SECRET (mismo valor usado al registrar el webhook, ver
 * TelegramConexionService) para que nadie pueda llamar este endpoint y
 * hacerse pasar por Telegram.
 */
@Injectable()
export class TelegramWebhookSecretGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const secretEsperado = this.configService.get<string>('TELEGRAM_WEBHOOK_SECRET');
    const secretRecibido = request.header('x-telegram-bot-api-secret-token');

    if (!secretEsperado || !secretRecibido || secretRecibido !== secretEsperado) {
      throw new UnauthorizedException('Firma de webhook de Telegram inválida');
    }
    return true;
  }
}
