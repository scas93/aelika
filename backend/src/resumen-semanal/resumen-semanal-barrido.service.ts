import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { correosDeConfig } from '../notificaciones/notificacion-correo-resumen';
import { ResumenSemanalEnvioService } from './resumen-semanal-envio.service';
import { semanaAnterior, ventanaActivaResumen } from './resumen-semanal';

export interface EstadisticasResumenSemanal {
  /** ¿Estaba en la ventana (lunes desde las 10:00 CDMX)? Si no, no se evaluó ningún negocio. */
  enVentana: boolean;
  negocios: number;
  enviados: number;
  fallidos: number;
  /** Ya tenían su resumen programado de esa semana. */
  duplicados: number;
  conError: number;
}

/**
 * Recorre los negocios de mayoreo que tienen el resumen semanal ACTIVO (canal Correo activo + evento RESUMEN_SEMANAL activo) y,
 * dentro de la ventana (lunes desde las 10:00 CDMX hasta el fin del día), envía el de la semana anterior. Se llama cada hora y
 * en el arranque: si el servidor estuvo caído a las 10, sale en cuanto vuelve a estar arriba ese mismo lunes; si no vuelve ese
 * día, esa semana se pierde. Un negocio que falle no impide los demás. Sin reintentos: un FALLO es definitivo para la semana.
 *
 * Seguro con varias instancias: la garantía contra duplicados es el índice único (negocio, semana) de `ResumenSemanalEnvio`
 * (ver `ResumenSemanalEnvioService`), no este proceso.
 */
@Injectable()
export class ResumenSemanalBarridoService {
  private readonly logger = new Logger(ResumenSemanalBarridoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: ResumenSemanalEnvioService,
  ) {}

  async ejecutar(ahora = new Date()): Promise<EstadisticasResumenSemanal> {
    const stats: EstadisticasResumenSemanal = {
      enVentana: ventanaActivaResumen(ahora),
      negocios: 0,
      enviados: 0,
      fallidos: 0,
      duplicados: 0,
      conError: 0,
    };
    if (!stats.enVentana) return stats;
    const semana = semanaAnterior(ahora);

    const configs = await this.prisma.notificacionEventoConfig.findMany({
      where: {
        evento: 'RESUMEN_SEMANAL',
        audiencia: 'NEGOCIO',
        activo: true,
        canalConfig: { tipo: 'CORREO', activo: true },
        tenant: { tipoStorefront: 'RETAIL_B2B' },
      },
      include: { canalConfig: true },
      orderBy: { createdAt: 'asc' },
    });
    stats.negocios = configs.length;

    // Secuencial a propósito: un negocio a la vez (el Excel puede ser grande) y un orden estable en los logs.
    for (const c of configs) {
      try {
        const cfg = c.canalConfig.config as { nombreRemitente?: unknown };
        const r = await this.envio.enviar(c.tenantId, semana, 'PROGRAMADO', {
          nombreRemitente:
            typeof cfg.nombreRemitente === 'string' ? cfg.nombreRemitente : '',
          correos: correosDeConfig(c.canalConfig.config),
        });
        if (r.resultado === 'EXITO') stats.enviados += 1;
        else if (r.resultado === 'FALLO') stats.fallidos += 1;
        else stats.duplicados += 1;
      } catch (error: unknown) {
        stats.conError += 1;
        this.logger.error(
          `Resumen semanal: error inesperado (tenant=${c.tenantId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.logger.log(
      `Resumen semanal ${semana.inicio}: ${stats.negocios} negocio(s), ${stats.enviados} enviado(s), ${stats.fallidos} con fallo, ${stats.duplicados} ya enviado(s), ${stats.conError} con error.`,
    );
    return stats;
  }
}
