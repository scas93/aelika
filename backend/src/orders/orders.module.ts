import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { NotificacionesReglasModule } from '../notificaciones-reglas/notificaciones-reglas.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [StripeModule, NotificacionesModule, NotificacionesReglasModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
