import { Module } from '@nestjs/common';
import { PedidosB2bController } from './pedidos-b2b.controller';
import { PedidosB2bService } from './pedidos-b2b.service';
import { CodigosDescuentoB2bController } from './codigos-descuento-b2b.controller';
import { CodigosDescuentoB2bService } from './codigos-descuento-b2b.service';
import { PublicPedidosB2bController } from './public-pedidos-b2b.controller';
import { PublicPedidosB2bService } from './public-pedidos-b2b.service';

@Module({
  controllers: [
    PedidosB2bController,
    CodigosDescuentoB2bController,
    PublicPedidosB2bController,
  ],
  providers: [
    PedidosB2bService,
    CodigosDescuentoB2bService,
    PublicPedidosB2bService,
  ],
})
export class PedidosB2bModule {}
