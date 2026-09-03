import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { TelegramConexionService } from './telegram-conexion.service';
import { TelegramWebhookSecretGuard } from './telegram-webhook-secret.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Role } from '../../../generated/prisma/enums';
import type { JwtPayload } from '../../common/types/jwt-payload.type';
import type { TelegramUpdate } from './telegram-update.type';

@Controller('notificaciones/telegram')
export class TelegramConexionController {
  constructor(private readonly telegramConexionService: TelegramConexionService) {}

  // Mismo criterio que el resto de Configuración/Ajustes (botApiKey, Stripe
  // Connect) — conectar un canal de notificaciones es una acción del Dueño.
  @Roles(Role.DUENO)
  @Post('conectar')
  generarLinkConexion(@CurrentUser() user: JwtPayload) {
    return this.telegramConexionService.generarLinkConexion(user.tenantId);
  }

  // @Public() para saltarse JwtAuthGuard/RolesGuard (Telegram no manda JWT)
  // + TelegramWebhookSecretGuard en su lugar — mismo patrón que
  // BotAuthGuard para /internal/bot-config (ver CLAUDE.md).
  @Public()
  @UseGuards(TelegramWebhookSecretGuard)
  @HttpCode(200)
  @Post('webhook')
  async webhook(@Body() update: TelegramUpdate) {
    await this.telegramConexionService.procesarUpdate(update);
    // Telegram solo le importa el 200 — cualquier cuerpo se ignora, pero
    // regresar algo explícito documenta la intención en vez de un 200 vacío
    // ambiguo.
    return { ok: true };
  }
}
