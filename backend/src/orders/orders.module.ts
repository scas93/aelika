import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [StripeModule, NotificacionesModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
