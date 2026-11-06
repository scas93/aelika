import { Module } from '@nestjs/common';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ResumenSemanalArmadoService } from './resumen-semanal-armado.service';
import { ResumenSemanalBarridoService } from './resumen-semanal-barrido.service';
import { ResumenSemanalCronService } from './resumen-semanal-cron.service';
import { ResumenSemanalController } from './resumen-semanal.controller';
import { ResumenSemanalEnvioService } from './resumen-semanal-envio.service';

/**
 * Resumen semanal por correo para negocios de mayoreo (ver docs/notificaciones.md). El `@Cron` usa el `ScheduleModule` que ya
 * registra `NotificacionesReglasModule` (`forRoot()` es global).
 */
@Module({
  imports: [NotificacionesModule],
  controllers: [ResumenSemanalController],
  providers: [
    ResumenSemanalArmadoService,
    ResumenSemanalEnvioService,
    ResumenSemanalBarridoService,
    ResumenSemanalCronService,
  ],
  exports: [ResumenSemanalEnvioService],
})
export class ResumenSemanalModule {}
