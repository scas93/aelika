import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { StripeModule } from '../stripe/stripe.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
  imports: [StripeModule, NotificacionesModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
