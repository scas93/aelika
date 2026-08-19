import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller';
import { InternalService } from './internal.service';
import { BotAuthGuard } from '../auth/guards/bot-auth.guard';

@Module({
  controllers: [InternalController],
  providers: [InternalService, BotAuthGuard],
})
export class InternalModule {}
