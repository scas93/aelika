import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { InternalService } from './internal.service';
import { BotAuthGuard } from '../auth/guards/bot-auth.guard';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [StripeModule],
  controllers: [InternalController],
  providers: [InternalService, BotAuthGuard, InternalApiKeyGuard],
})
export class InternalModule {}
