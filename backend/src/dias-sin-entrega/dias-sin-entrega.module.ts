import { Module } from '@nestjs/common';
import { DiasSinEntregaController } from './dias-sin-entrega.controller';
import { DiasSinEntregaService } from './dias-sin-entrega.service';

@Module({
  controllers: [DiasSinEntregaController],
  providers: [DiasSinEntregaService],
})
export class DiasSinEntregaModule {}
