import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Cliente, Regla, Tenant } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReglasFiltroService } from './reglas-filtro.service';
import { ReglaCandadoService } from './regla-candado.service';
import { ReglaEnvioService } from './regla-envio.service';
import { FiltroCondicion } from './filtro-condicion.type';

type ReglaConTenant = Regla & { tenant: Tenant };

interface EstadisticasBarrido {
  reglasProcesadas: number;
  reglasConError: number;
  enviosDisparados: number;
  enviosBloqueadosPorCandado: number;
  enviosConError: number;
}

/**
 * Job periódico único (no uno por Regla, ver CLAUDE.md) que en cada corrida
 * recorre todas las Regla activas de tipo ESTADO_CLIENTE/FECHA_PROGRAMADA de
 * TODOS los tenants, evalúa su Filtro (ReglasFiltroService, Etapa 1), y
 * dispara los envíos que correspondan (ReglaCandadoService + ReglaEnvioService,
 * Etapa 1/2a) — sin repetir esa lógica aquí, solo la orquesta.
 *
 * EVENTO_PEDIDO y MANUAL quedan fuera de este barrido a propósito: el primero
 * se conecta al ciclo de vida real de Order/PedidoB2b en la Etapa 2c, el
 * segundo se dispara a mano desde el panel en la Etapa 3 — ninguno de los
 * dos es "periódico".
 *
 * SUPUESTO DECLARADO — una sola instancia de backend: `@Cron` de
 * @nestjs/schedule corre una vez POR INSTANCIA del proceso Nest, sin
 * deduplicación entre instancias (a diferencia de un repeatable job de
 * BullMQ, que sí se deduplica vía Redis). Hoy el backend corre en una sola
 * instancia (ver CLAUDE.md, Render/Railway sin autoscaling configurado
 * todavía), así que esto es seguro. Si el backend llegara a escalar a más
 * de una instancia, este job empezaría a correr duplicado (y a mandar
 * envíos duplicados) — habría que migrar a un repeatable job de BullMQ (o
 * un lock distribuido) antes de escalar, no después.
 *
 * SUPUESTO DECLARADO — Regla.triggerConfig.fechaHora es un instante
 * absoluto: se parsea con `new Date(...)` y se compara directo contra
 * `new Date()` de la corrida, sin ninguna conversión de timezone. Esto solo
 * es correcto si `fechaHora` se guarda como ISO 8601 CON offset/zulu (ej.
 * "2026-09-10T21:00:00.000Z", no "2026-09-10T15:00:00" a secas) — un string
 * sin offset lo interpretaría el runtime de Node con su propio timezone
 * local, no con America/Mexico_City. La Etapa 1 no especificó el formato
 * exacto; este servicio asume que quien escriba triggerConfig (hoy solo
 * scripts/DB directo, panel real en Etapa 3) ya guarda el offset explícito.
 */
@Injectable()
export class ReglaBarridoService {
  private readonly logger = new Logger(ReglaBarridoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly filtroService: ReglasFiltroService,
    private readonly candadoService: ReglaCandadoService,
    private readonly envioService: ReglaEnvioService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async ejecutarBarrido(): Promise<EstadisticasBarrido> {
    const ahora = new Date();
    const stats: EstadisticasBarrido = {
      reglasProcesadas: 0,
      reglasConError: 0,
      enviosDisparados: 0,
      enviosBloqueadosPorCandado: 0,
      enviosConError: 0,
    };

    const reglas = (await this.prisma.regla.findMany({
      where: { activa: true, trigger: { in: ['ESTADO_CLIENTE', 'FECHA_PROGRAMADA'] } },
      include: { tenant: true },
    })) as ReglaConTenant[];

    this.logger.log(`Barrido de Reglas iniciado (${reglas.length} regla(s) activa(s) a revisar).`);

    // Deliberadamente secuencial (sin Promise.all/concurrencia) — no solo
    // por simplicidad: es lo que garantiza que, si dos Reglas Marketing
    // distintas matchean al mismo Cliente en esta misma corrida, la
    // segunda vea el ReglaEnvioLog que dejó la primera al revisar el
    // candado (check-then-act). Procesarlas en paralelo introduciría una
    // condición de carrera exactamente en ese escenario (ver casos borde
    // del prompt de esta etapa).
    for (const regla of reglas) {
      try {
        if (regla.trigger === 'ESTADO_CLIENTE') {
          await this.procesarEstadoCliente(regla, stats);
        } else {
          await this.procesarFechaProgramada(regla, ahora, stats);
        }
        stats.reglasProcesadas++;
      } catch (error: any) {
        // Aislamiento obligatorio: una Regla que truena (ej. Filtro
        // malformado) no debe tumbar el resto de la corrida — mismo
        // criterio que NotificacionesProcessor con canales individuales.
        stats.reglasConError++;
        this.logger.error(`Error procesando Regla ${regla.id} (tenant=${regla.tenantId}): ${error?.message ?? error}`);
      }
    }

    this.logger.log(
      `Barrido de Reglas terminado: ${stats.reglasProcesadas} procesada(s), ${stats.reglasConError} con error, ` +
        `${stats.enviosDisparados} envío(s) disparado(s), ${stats.enviosBloqueadosPorCandado} bloqueado(s) por candado, ` +
        `${stats.enviosConError} envío(s) con error.`,
    );

    return stats;
  }

  private async procesarEstadoCliente(regla: ReglaConTenant, stats: EstadisticasBarrido): Promise<void> {
    const condiciones = regla.filtro as unknown as FiltroCondicion[];
    const clientes = await this.filtroService.evaluar(regla.tenantId, condiciones);

    for (const cliente of clientes) {
      await this.intentarEnviar(regla, cliente, stats);
    }
  }

  private async procesarFechaProgramada(regla: ReglaConTenant, ahora: Date, stats: EstadisticasBarrido): Promise<void> {
    // Ya se disparó en una corrida anterior — no se repite (ver comentario
    // de Regla.disparadaEn en schema.prisma).
    if (regla.disparadaEn) return;

    const config = regla.triggerConfig as unknown as { fechaHora: string };
    const fechaHora = new Date(config.fechaHora);

    if (fechaHora.getUTCMinutes() !== 0 || fechaHora.getUTCSeconds() !== 0) {
      // Solo se loguea como inconsistencia — se usa `fechaHora` tal cual
      // para la comparación de abajo (sin truncar a la hora), no tiene
      // sentido inventar un redondeo silencioso sobre un dato que la
      // Etapa 3 va a validar en el origen. Ver "Validación a nivel de
      // datos" del prompt de esta etapa.
      this.logger.warn(
        `Regla ${regla.id} (FECHA_PROGRAMADA) tiene triggerConfig.fechaHora con minutos/segundos distintos de cero (${config.fechaHora}) — se usa tal cual, sin redondear.`,
      );
    }

    if (fechaHora > ahora) return; // todavía no se cumple

    const condiciones = regla.filtro as unknown as FiltroCondicion[];
    const clientes = await this.filtroService.evaluar(regla.tenantId, condiciones);

    for (const cliente of clientes) {
      await this.intentarEnviar(regla, cliente, stats);
    }

    // Se marca disparada sin importar cuántos clientes matcheó el Filtro
    // (incluso 0) — lo que ocurre una sola vez es el trigger de tiempo, no
    // "hubo al menos un envío exitoso" (ver comentario del campo en
    // schema.prisma).
    await this.prisma.regla.update({ where: { id: regla.id }, data: { disparadaEn: ahora } });
  }

  private async intentarEnviar(regla: ReglaConTenant, cliente: Cliente, stats: EstadisticasBarrido): Promise<void> {
    try {
      const bloqueado = await this.candadoService.estaBloqueado(regla.tenantId, cliente.id, regla.plantillaCategoria);
      if (bloqueado) {
        stats.enviosBloqueadosPorCandado++;
        return;
      }

      await this.envioService.enviar(regla.tenant, cliente, regla);
      stats.enviosDisparados++;
    } catch (error: any) {
      // Aislamiento por Cliente: un envío que falla (ej. tenant sin
      // botWebhookUrl) no debe impedir que se intente con el resto de los
      // clientes que matchearon esta Regla, ni con las demás Reglas de la
      // corrida.
      stats.enviosConError++;
      this.logger.error(
        `Error enviando Regla ${regla.id} a Cliente ${cliente.id} (tenant=${regla.tenantId}): ${error?.message ?? error}`,
      );
    }
  }
}
