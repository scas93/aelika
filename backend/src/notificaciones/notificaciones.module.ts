import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { NotificacionCanalConfigService } from './notificacion-canal-config.service';
import { NotificacionEventoConfigService } from './notificacion-evento-config.service';
import { NOTIFICACIONES_QUEUE } from './queue/notificaciones-queue.constants';
import { NotificacionesQueueService } from './queue/notificaciones-queue.service';
import { NotificacionesProcessor } from './queue/notificaciones.processor';
import { TelegramProvider } from './providers/telegram.provider';
import { CorreoProvider } from './providers/correo.provider';
import { NotificacionProvidersRegistry } from './providers/notificacion-providers.registry';
import { TelegramTokenService } from './telegram/telegram-token.service';
import { TelegramConexionService } from './telegram/telegram-conexion.service';
import { TelegramWebhookSecretGuard } from './telegram/telegram-webhook-secret.guard';
import { TelegramConexionController } from './telegram/telegram-conexion.controller';
import { NotificacionCanalConfigController } from './notificacion-canal-config.controller';
import { NotificacionEventoConfigController } from './notificacion-evento-config.controller';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // Same "redis" service already running in docker-compose.yml for
      // local dev — see REDIS_URL in .env.example. No Railway Redis exists
      // yet for staging/production (see CLAUDE.md); connecting there is
      // pending infra work, not something this phase can provision.
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue({ name: NOTIFICACIONES_QUEUE }),
  ],
  controllers: [TelegramConexionController, NotificacionCanalConfigController, NotificacionEventoConfigController],
  providers: [
    NotificacionCanalConfigService,
    NotificacionEventoConfigService,
    NotificacionesQueueService,
    NotificacionesProcessor,
    TelegramProvider,
    CorreoProvider,
    NotificacionProvidersRegistry,
    TelegramTokenService,
    TelegramConexionService,
    TelegramWebhookSecretGuard,
  ],
  exports: [NotificacionCanalConfigService, NotificacionEventoConfigService, NotificacionesQueueService],
})
export class NotificacionesModule {}
