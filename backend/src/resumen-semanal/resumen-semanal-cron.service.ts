import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ResumenSemanalBarridoService } from './resumen-semanal-barrido.service';

/**
 * Disparador del resumen semanal: cada hora (la ventana lunes 10:00 CDMX la decide `ResumenSemanalBarridoService`, en hora de
 * CDMX y no la del servidor) y una vez al arrancar, para que un reinicio el lunes después de las 10 no espere a la siguiente
 * hora. Separado del barrido para poder sustituirlo en las pruebas (el `@Cron` no debe correr solo en la suite).
 */
@Injectable()
export class ResumenSemanalCronService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ResumenSemanalCronService.name);

  constructor(private readonly barrido: ResumenSemanalBarridoService) {}

  onApplicationBootstrap() {
    void this.correr('arranque');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cadaHora() {
    await this.correr('hora');
  }

  private async correr(origen: string) {
    try {
      await this.barrido.ejecutar();
    } catch (error: unknown) {
      this.logger.error(
        `Resumen semanal (${origen}) falló: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
