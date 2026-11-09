import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { fechaDeSemana } from '../notificaciones-reglas/recordatorio-semanal';
import { ResumenSemanalClienteEnvioService } from './resumen-semanal-cliente-envio.service';
import { inicioVentanaDeEnvio } from './resumen-semanal-cliente';
import { semanaAnterior, ventanaActivaResumen } from './resumen-semanal';

/**
 * Pausa entre un correo y el siguiente. Resend limita las peticiones por segundo del equipo (la documentación consultada da
 * 2, 5 y 10 por segundo según la página): 600 ms ≈ 1.7 por segundo queda por debajo del valor más bajo. Se puede cambiar con
 * RESUMEN_CLIENTES_PAUSA_MS sin tocar código.
 */
const PAUSA_ENTRE_ENVIOS_MS_DEFAULT = 600;

export interface EstadisticasResumenClientes {
  enVentana: boolean;
  negocios: number;
  enviados: number;
  fallidos: number;
  duplicados: number;
  omitidos: number;
  /** Resend siguió limitando: quedan para la siguiente ejecución del mismo lunes. */
  diferidos: number;
  conError: number;
}

/**
 * Resumen semanal por cliente B2B. Dentro de la ventana (lunes desde las 10:00 CDMX hasta el fin del día) recorre los negocios de
 * mayoreo con el interruptor general (evento RESUMEN_SEMANAL + audiencia CLIENTE) encendido y manda, uno por uno y a ritmo
 * controlado, el resumen de la semana anterior a cada cliente que: está activo (sin baja), tiene su interruptor encendido y un
 * correo propio capturado, y tuvo al menos un pedido esa semana. Ninguna activación es retroactiva: el interruptor del negocio
 * y el del cliente deben haberse encendido ANTES de las 10:00 de ese lunes. Un fallo con un cliente no impide los demás; sin
 * reintentos (salvo el rechazo por tasa de Resend, que no pierde el correo). No depende del canal Correo del resumen al negocio.
 */
@Injectable()
export class ResumenSemanalClienteBarridoService {
  private readonly logger = new Logger(ResumenSemanalClienteBarridoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: ResumenSemanalClienteEnvioService,
    private readonly config: ConfigService,
  ) {}

  async ejecutar(ahora = new Date()): Promise<EstadisticasResumenClientes> {
    const stats: EstadisticasResumenClientes = {
      enVentana: ventanaActivaResumen(ahora),
      negocios: 0,
      enviados: 0,
      fallidos: 0,
      duplicados: 0,
      omitidos: 0,
      diferidos: 0,
      conError: 0,
    };
    if (!stats.enVentana) return stats;
    const semana = semanaAnterior(ahora);
    const abreVentana = inicioVentanaDeEnvio(semana);
    const lunesSemana = fechaDeSemana(semana.inicio);

    const configs = await this.prisma.notificacionEventoConfig.findMany({
      where: {
        evento: 'RESUMEN_SEMANAL',
        audiencia: 'CLIENTE',
        activo: true,
        // Encendido (o editado) antes de que abriera la ventana de ESTE lunes: si no, el primer envío es el lunes siguiente.
        updatedAt: { lte: abreVentana },
        tenant: { tipoStorefront: 'RETAIL_B2B' },
      },
      include: {
        tenant: { select: { id: true, nombre: true, correoRespuestas: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    stats.negocios = configs.length;

    let pausar = false;
    negocios: for (const c of configs) {
      try {
        const clientes = await this.prisma.cliente.findMany({
          where: {
            tenantId: c.tenantId,
            canal: 'B2B',
            bajaAt: null,
            resumenSemanalActivo: true,
            resumenSemanalCorreo: { not: null },
            resumenSemanalActivadoAt: { lte: abreVentana },
            orders: {
              some: { tipo: 'B2B', detalleB2b: { is: { semanaInicio: lunesSemana } } },
            },
            resumenSemanalEnvios: { none: { semanaInicio: lunesSemana } },
          },
          select: { id: true, nombre: true, resumenSemanalCorreo: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        for (const cli of clientes) {
          if (pausar) await this.esperar(this.pausaMs());
          try {
            const r = await this.envio.enviarProgramado(
              {
                id: cli.id,
                tenantId: c.tenantId,
                nombre: cli.nombre,
                correoResumen: cli.resumenSemanalCorreo!,
              },
              {
                nombre: c.tenant.nombre,
                correoRespuestas: c.tenant.correoRespuestas,
              },
              semana,
            );
            if (r.resultado === 'EXITO') stats.enviados += 1;
            else if (r.resultado === 'FALLO') stats.fallidos += 1;
            else if (r.resultado === 'DUPLICADO') stats.duplicados += 1;
            else if (r.resultado === 'OMITIDO') stats.omitidos += 1;
            else {
              // Resend sigue limitando: es del equipo entero, no de este cliente. Se corta; la siguiente ejecución sigue.
              stats.diferidos += 1;
              break negocios;
            }
            pausar = r.resultado === 'EXITO' || r.resultado === 'FALLO';
          } catch (error: unknown) {
            stats.conError += 1;
            this.logger.error(
              `Resumen a clientes: error inesperado (tenant=${c.tenantId}, cliente=${cli.id}): ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } catch (error: unknown) {
        stats.conError += 1;
        this.logger.error(
          `Resumen a clientes: error inesperado (tenant=${c.tenantId}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (
      stats.enviados + stats.fallidos + stats.duplicados + stats.omitidos + stats.diferidos + stats.conError >
      0
    ) {
      this.logger.log(
        `Resumen a clientes ${semana.inicio}: ${stats.negocios} negocio(s), ${stats.enviados} enviado(s), ${stats.fallidos} con fallo, ${stats.duplicados} ya enviado(s), ${stats.diferidos} diferido(s), ${stats.conError} con error.`,
      );
    }
    return stats;
  }

  private pausaMs(): number {
    const n = Number(this.config.get('RESUMEN_CLIENTES_PAUSA_MS'));
    return Number.isFinite(n) && n >= 0 ? n : PAUSA_ENTRE_ENVIOS_MS_DEFAULT;
  }

  /** Aparte para poder sustituirla en las pruebas (sin esperas reales). */
  protected esperar(ms: number): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }
}
