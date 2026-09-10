import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ReglasFiltroService } from './reglas-filtro.service';
import { ReglaCandadoService } from './regla-candado.service';
import { ReglaEnvioService } from './regla-envio.service';
import { ReglaEnvioCallbackController } from './regla-envio-callback.controller';
import { ReglaBarridoService } from './regla-barrido.service';
import { ReglaEventoPedidoService } from './regla-evento-pedido.service';

@Module({
  // ScheduleModule.forRoot() registra el SchedulerRegistry que @Cron
  // necesita (ver ReglaBarridoService) — se importa aquí, no en AppModule,
  // porque este módulo es el único consumidor de jobs periódicos en el
  // proyecto por ahora (mismo criterio de auto-contención que
  // NotificacionesModule con su propio BullModule.forRootAsync).
  imports: [ScheduleModule.forRoot()],
  controllers: [ReglaEnvioCallbackController],
  providers: [ReglasFiltroService, ReglaCandadoService, ReglaEnvioService, ReglaBarridoService, ReglaEventoPedidoService],
  exports: [ReglasFiltroService, ReglaCandadoService, ReglaEnvioService, ReglaBarridoService, ReglaEventoPedidoService],
})
export class NotificacionesReglasModule {}
