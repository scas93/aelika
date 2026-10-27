import { Module } from '@nestjs/common';
import { BotAuthGuard } from '../auth/guards/bot-auth.guard';
import { ReservasController } from './reservas.controller';
import { ReservasService } from './reservas.service';

@Module({
  controllers: [ReservasController],
  providers: [ReservasService, BotAuthGuard],
})
export class ReservasModule {}
