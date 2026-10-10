import { Module } from '@nestjs/common';
import { PruebaSesionController } from './prueba-sesion.controller';
import { PruebaSesionService } from './prueba-sesion.service';

@Module({
  controllers: [PruebaSesionController],
  providers: [PruebaSesionService],
})
export class PortalModule {}
