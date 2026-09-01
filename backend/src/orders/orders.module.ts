import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [StripeModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
