import { Module } from '@nestjs/common';
import { ResumenSemanalArmadoService } from './resumen-semanal-armado.service';

/** Resumen semanal por correo para negocios de mayoreo (ver docs/notificaciones.md). */
@Module({
  providers: [ResumenSemanalArmadoService],
  exports: [ResumenSemanalArmadoService],
})
export class ResumenSemanalModule {}
