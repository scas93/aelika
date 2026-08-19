import { Module } from '@nestjs/common';
import { PuntosEnvioController } from './puntos-envio.controller';
import { PuntosEnvioService } from './puntos-envio.service';

@Module({
  controllers: [PuntosEnvioController],
  providers: [PuntosEnvioService],
})
export class PuntosEnvioModule {}
