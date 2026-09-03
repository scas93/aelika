import { Module } from '@nestjs/common';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeModule } from '../stripe/stripe.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports: [StripeModule, NotificacionesModule],
  controllers: [StripeWebhookController],
})
export class WebhooksModule {}
