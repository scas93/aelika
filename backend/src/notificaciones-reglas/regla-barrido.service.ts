import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Cliente, Regla, Tenant } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReglasFiltroService } from './reglas-filtro.service';
import { ReglaCandadoService } from './regla-candado.service';
import { ReglaEnvioService } from './regla-envio.service';
import { FiltroCondicion } from './filtro-condicion.type';
import { PedidoContextoReserva } from './plantilla-variable.type';
import {
  TriggerConfigReserva,
  CondicionReserva,
  coincideIdioma,
  condicionesDiasAWhere,
  hoyCdmx,
  ventanaActiva,
} from './reserva-trigger';

type ReglaConTenant = Regla & { tenant: Tenant };

interface EstadisticasBarrido {
  reglasProcesadas: number;
  reglasConError: number;
  enviosDisparados: number;
  enviosBloqueadosPorCandado: number;
  enviosConError: number;
  omitidosYaEnviado: number;
  clientesBaseRegistrados: number;
}

type ResultadoEnvio = 'enviado' | 'bloqueado' | 'error';

/** Resultado de «Ejecutar ahora» sobre una regla RESERVA_AUTOMATICA (ver `ReglaBarridoService.ejecutarReservaAhora`). */
export interface ResumenEjecucionReserva {
  /** Reservas no canceladas que cumplen el filtro de la regla (incluye las que ya recibieron el mensaje). */
  reservasEvaluadas: number;
  /** Envíos hechos en esta ejecución que Botpress aceptó (quedan EN_CURSO hasta su callback). */
  enviadas: number;
  /** Reservas que ya tenían un registro de esta regla (EN_CURSO, EXITO o FALLO): no se reenvían. */
  omitidasYaEnviadas: number;
  /** Envíos de esta ejecución que fallaron (Botpress rechazó o no respondió, o el envío no pudo ni intentarse). */
  fallidas: number;
  /** Reservas a las que el candado de Marketing impidió enviar (siguen pendientes). */
  bloqueadasPorCandado: number;
  /** Regla diaria evaluada antes de su hora: no se evaluó ninguna reserva. */
  fueraDeVentana: boolean;
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
  private readonly reglasEjecutandoAhora = new Set<string>();

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
      omitidosYaEnviado: 0,
      clientesBaseRegistrados: 0,
    };

    const reglas = (await this.prisma.regla.findMany({
      where: { activa: true, trigger: { in: ['ESTADO_CLIENTE', 'FECHA_PROGRAMADA', 'RESERVA_AUTOMATICA'] } },
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
        } else if (regla.trigger === 'RESERVA_AUTOMATICA') {
          await this.procesarReservas(regla, ahora, stats);
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
        `${stats.enviosConError} envío(s) con error, ` +
        `${stats.omitidosYaEnviado} omitido(s) por ya enviado, ${stats.clientesBaseRegistrados} cliente(s) registrado(s) como base sin enviar.`,
    );

    return stats;
  }

  /**
   * ESTADO_CLIENTE: un cliente recibe la regla UNA vez mientras siga cumpliendo el filtro. `ReglaClienteEstado` guarda
   * quién cumple hoy; en cada barrido se recalcula el conjunto:
   *  - sale (estaba registrado y ya no cumple) → se borra su fila, así que si vuelve a cumplir recibe otra vez;
   *  - sigue (registrado y cumple) → no se envía, cuenta como omitido;
   *  - entra (cumple y no estaba registrado) → candado y envío; si se intentó enviar (aunque terminara en FALLO, que es
   *    definitivo) se registra; si el candado lo bloquea o el envío no pudo ni intentarse (tenant sin webhook, cliente
   *    sin teléfono) NO se registra y se reevalúa en el siguiente barrido.
   * `estadoBasePendiente` (lo enciende la migración en las reglas que ya operaban): ese barrido solo registra a quienes
   * ya cumplen, sin enviar.
   */
  private async procesarEstadoCliente(regla: ReglaConTenant, stats: EstadisticasBarrido): Promise<void> {
    const condiciones = regla.filtro as unknown as FiltroCondicion[];
    const clientes = await this.filtroService.evaluar(regla.tenantId, condiciones);
    const cumplen = new Set(clientes.map((c) => c.id));

    const filas = await this.prisma.reglaClienteEstado.findMany({ where: { reglaId: regla.id }, select: { clienteId: true } });
    const registrados = new Set(filas.map((f) => f.clienteId));

    const salen = [...registrados].filter((id) => !cumplen.has(id));
    if (salen.length > 0) {
      await this.prisma.reglaClienteEstado.deleteMany({ where: { reglaId: regla.id, clienteId: { in: salen } } });
    }

    const entran = clientes.filter((c) => !registrados.has(c.id));
    stats.omitidosYaEnviado += clientes.length - entran.length;

    if (regla.estadoBasePendiente) {
      await this.registrar(regla, entran.map((c) => c.id));
      await this.prisma.regla.update({ where: { id: regla.id }, data: { estadoBasePendiente: false } });
      stats.clientesBaseRegistrados += entran.length;
      return;
    }

    for (const cliente of entran) {
      const resultado = await this.intentarEnviar(regla, cliente, stats);
      if (resultado === 'enviado') {
        await this.registrar(regla, [cliente.id]);
      }
    }
  }

  /**
   * RESERVA_AUTOMATICA (solo hoteles): reservas NO canceladas que cumplen el filtro de días/idioma y a las que esta regla
   * todavía no ha enviado nada (un envío por regla y reserva: cualquier ReglaEnvioLog de esa regla para esa reserva —EN_CURSO,
   * EXITO o FALLO— cuenta como enviado, sin importar si luego se canceló o reactivó). Las DIARIAS solo corren desde su hora
   * (CDMX) hasta el fin del día. Bloqueada por candado, o un envío que ni pudo intentarse, NO deja registro: se reevalúa en el
   * siguiente barrido mientras la reserva siga dentro de la ventana del filtro.
   */
  private async procesarReservas(regla: ReglaConTenant, ahora: Date, stats: EstadisticasBarrido): Promise<void> {
    if (regla.tenant.tipoStorefront !== 'HOTEL') return;
    const config = regla.triggerConfig as unknown as TriggerConfigReserva;
    if (!ventanaActiva(config, ahora)) return;

    const condiciones = regla.filtro as unknown as CondicionReserva[];
    const reservas = await this.prisma.order.findMany({
      where: {
        tenantId: regla.tenantId,
        tipo: 'RESERVA',
        cancelado: false,
        reglaEnvioLogs: { none: { reglaId: regla.id } },
        detalleReserva: { is: { AND: condicionesDiasAWhere(condiciones, hoyCdmx(ahora)) } },
      },
      include: { detalleReserva: true, cliente: true },
      orderBy: { createdAt: 'asc' },
    });

    for (const reserva of reservas) {
      const det = reserva.detalleReserva;
      if (!det || !coincideIdioma(condiciones, det.idiomaHuesped)) continue;
      const contexto: PedidoContextoReserva = {
        origen: 'RESERVA',
        folio: det.pmsReservaId,
        total: reserva.total,
        estatus: '',
        createdAt: reserva.createdAt,
        items: [],
        checkIn: det.checkIn,
        checkOut: det.checkOut,
        adultos: det.adultos,
        ninos: det.ninos,
        habitaciones: det.habitaciones,
        enlaceCheckin: det.onlineCheckinUrl,
      };
      await this.intentarEnviar(regla, reserva.cliente, stats, contexto, reserva.id);
    }
  }

  /**
   * «Ejecutar ahora» (solo Dueño, solo negocios Hotel): evalúa UNA regla RESERVA_AUTOMATICA en este momento con exactamente
   * la misma evaluación del barrido (`procesarReservas`: filtro, solo reservas no canceladas, un envío por regla y reserva,
   * ventana de las diarias y candado de Marketing). Ejecutarla de nuevo no reenvía nada: lo ya enviado (EN_CURSO, EXITO o
   * FALLO) se omite. El resumen se calcula aparte de `procesarReservas` (que no se toca): una consulta previa cuenta las
   * reservas evaluadas y las ya enviadas, y después se lee el estado de los registros que dejó esta ejecución.
   * Un clic doble o dos pestañas a la vez sobre la MISMA regla: la segunda recibe 409 (candado en memoria, válido mientras el
   * backend corra en una sola instancia, el mismo supuesto del barrido). No se coordina con el barrido horario.
   */
  async ejecutarReservaAhora(reglaId: string, tenantId: string): Promise<ResumenEjecucionReserva> {
    const regla = (await this.prisma.regla.findFirst({
      where: { id: reglaId, tenantId },
      include: { tenant: true },
    })) as ReglaConTenant | null;
    if (!regla) throw new NotFoundException('Regla no encontrada');
    if (regla.trigger !== 'RESERVA_AUTOMATICA') {
      throw new BadRequestException('Solo se puede ejecutar ahora una regla de reservas (RESERVA_AUTOMATICA).');
    }
    if (regla.tenant.tipoStorefront !== 'HOTEL') {
      throw new BadRequestException('Las reglas de reservas solo están disponibles para negocios de tipo Hotel.');
    }
    if (!regla.activa) throw new BadRequestException('Esta Regla está inactiva.');
    if (this.reglasEjecutandoAhora.has(regla.id)) {
      throw new ConflictException('Esta regla ya se está ejecutando, espera a que termine.');
    }

    this.reglasEjecutandoAhora.add(regla.id);
    try {
      const ahora = new Date();
      const resumen: ResumenEjecucionReserva = {
        reservasEvaluadas: 0,
        enviadas: 0,
        omitidasYaEnviadas: 0,
        fallidas: 0,
        bloqueadasPorCandado: 0,
        fueraDeVentana: false,
      };
      const config = regla.triggerConfig as unknown as TriggerConfigReserva;
      if (!ventanaActiva(config, ahora)) {
        resumen.fueraDeVentana = true;
        return resumen;
      }

      const condiciones = regla.filtro as unknown as CondicionReserva[];
      const candidatas = await this.prisma.order.findMany({
        where: {
          tenantId: regla.tenantId,
          tipo: 'RESERVA',
          cancelado: false,
          detalleReserva: { is: { AND: condicionesDiasAWhere(condiciones, hoyCdmx(ahora)) } },
        },
        select: {
          id: true,
          detalleReserva: { select: { idiomaHuesped: true } },
          reglaEnvioLogs: { where: { reglaId: regla.id }, select: { id: true }, take: 1 },
        },
      });
      const evaluadas = candidatas.filter((o) => o.detalleReserva && coincideIdioma(condiciones, o.detalleReserva.idiomaHuesped));
      const pendientes = evaluadas.filter((o) => o.reglaEnvioLogs.length === 0).map((o) => o.id);
      resumen.reservasEvaluadas = evaluadas.length;
      resumen.omitidasYaEnviadas = evaluadas.length - pendientes.length;

      const stats: EstadisticasBarrido = {
        reglasProcesadas: 0,
        reglasConError: 0,
        enviosDisparados: 0,
        enviosBloqueadosPorCandado: 0,
        enviosConError: 0,
        omitidosYaEnviado: 0,
        clientesBaseRegistrados: 0,
      };
      await this.procesarReservas(regla, ahora, stats);

      // Un envío que Botpress rechaza o que vence no lanza: deja su registro en FALLO. Se lee de ahí, no de `stats`.
      const registros = await this.prisma.reglaEnvioLog.findMany({
        where: { reglaId: regla.id, orderId: { in: pendientes } },
        select: { estado: true },
      });
      const fallosRegistrados = registros.filter((r) => r.estado === 'FALLO').length;
      resumen.enviadas = registros.length - fallosRegistrados;
      resumen.fallidas = fallosRegistrados + stats.enviosConError;
      resumen.bloqueadasPorCandado = stats.enviosBloqueadosPorCandado;

      this.logger.log(
        `Ejecución manual de Regla ${regla.id} (tenant=${regla.tenantId}): ${resumen.reservasEvaluadas} evaluada(s), ` +
          `${resumen.enviadas} enviada(s), ${resumen.omitidasYaEnviadas} ya enviada(s), ${resumen.fallidas} fallida(s), ` +
          `${resumen.bloqueadasPorCandado} bloqueada(s) por candado.`,
      );
      return resumen;
    } finally {
      this.reglasEjecutandoAhora.delete(regla.id);
    }
  }

  private async registrar(regla: ReglaConTenant, clienteIds: string[]): Promise<void> {
    if (clienteIds.length === 0) return;
    await this.prisma.reglaClienteEstado.createMany({
      data: clienteIds.map((clienteId) => ({ tenantId: regla.tenantId, reglaId: regla.id, clienteId })),
      skipDuplicates: true,
    });
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

  private async intentarEnviar(
    regla: ReglaConTenant,
    cliente: Cliente,
    stats: EstadisticasBarrido,
    contexto?: PedidoContextoReserva,
    orderId?: string,
  ): Promise<ResultadoEnvio> {
    try {
      const bloqueado = await this.candadoService.estaBloqueado(regla.tenant, cliente.id, regla.plantillaCategoria);
      if (bloqueado) {
        stats.enviosBloqueadosPorCandado++;
        return 'bloqueado';
      }

      await this.envioService.enviar(regla.tenant, cliente, regla, contexto, orderId);
      stats.enviosDisparados++;
      return 'enviado';
    } catch (error: any) {
      // Aislamiento por Cliente: un envío que falla (ej. tenant sin
      // botWebhookUrl) no debe impedir que se intente con el resto de los
      // clientes que matchearon esta Regla, ni con las demás Reglas de la
      // corrida.
      stats.enviosConError++;
      this.logger.error(
        `Error enviando Regla ${regla.id} a Cliente ${cliente.id} (tenant=${regla.tenantId}): ${error?.message ?? error}`,
      );
      return 'error';
    }
  }
}
