import { Module } from '@nestjs/common';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeModule } from '../stripe/stripe.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { PublicModule } from '../public/public.module';

@Module({
  imports: [StripeModule, NotificacionesModule, PublicModule],
  controllers: [StripeWebhookController],
})
export class WebhooksModule {}
