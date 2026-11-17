import { Module } from '@nestjs/common';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { EntregaConfirmadaController } from './entrega-confirmada.controller';
import { EntregaConfirmadaService } from './entrega-confirmada.service';

/** Correo «Entrega confirmada» al cliente B2B (ver docs/notificaciones.md). Lo dispara PedidosB2bService al cerrar una entrega. */
@Module({
  imports: [NotificacionesModule],
  controllers: [EntregaConfirmadaController],
  providers: [EntregaConfirmadaService],
  exports: [EntregaConfirmadaService],
})
export class EntregaConfirmadaModule {}
