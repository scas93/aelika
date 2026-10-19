import { Module } from '@nestjs/common';
import { AdopcionController } from './adopcion.controller';
import { AdopcionService } from './adopcion.service';

@Module({
  controllers: [AdopcionController],
  providers: [AdopcionService],
})
export class AdopcionModule {}
