import { Module } from '@nestjs/common';
import { AvisoPedidoModificadoService } from './aviso-pedido-modificado.service';
import { AvisoWebhookClient } from './aviso-webhook.client';
import { AvisosPedidoCallbackController } from './avisos-pedido-callback.controller';

@Module({
  controllers: [AvisosPedidoCallbackController],
  providers: [AvisoPedidoModificadoService, AvisoWebhookClient],
  exports: [AvisoPedidoModificadoService],
})
export class AvisosInternosModule {}
