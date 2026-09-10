import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import {
  EstadoPedido,
  PedidoB2bEstado,
  ReglaFiltroCampo,
  ReglaFiltroOperador,
  ReglaPlantillaVariableFuente,
  ReglaTriggerOrigenPedido,
  ReglaTriggerTipo,
} from '../../generated/prisma/enums';
import { CreateReglaDto } from './dto/create-regla.dto';
import { UpdateReglaDto } from './dto/update-regla.dto';
import { FiltroCondicionDto } from './dto/filtro-condicion.dto';
import { PlantillaVariableDto } from './dto/plantilla-variable.dto';
import { EventoPedidoTriggerConfigDto } from './dto/evento-pedido-trigger-config.dto';
import { FechaProgramadaTriggerConfigDto } from './dto/fecha-programada-trigger-config.dto';
import { CAMPO_CLIENTE_SOPORTADO, CAMPO_PEDIDO_SOPORTADO } from './plantilla-variable.type';
import { ReglasFiltroService } from './reglas-filtro.service';
import { ReglaCandadoService } from './regla-candado.service';
import { ReglaEnvioService } from './regla-envio.service';
import { FiltroCondicion } from './filtro-condicion.type';

const PRISMA_NOT_FOUND = 'P2025';

interface PayloadValidado {
  triggerConfig: Record<string, unknown> | null;
  filtro: unknown[];
  plantillaVariables: unknown[];
}

export interface ResumenDisparoManual {
  clientesMatcheados: number;
  enviosDisparados: number;
  bloqueadosPorCandado: number;
  conError: number;
}

/**
 * CRUD de Regla (Etapa 3) — primer camino de escritura no confiable de este
 * modelo (hasta ahora `filtro`/`triggerConfig`/`plantillaVariables` siempre
 * se insertaron a mano en base de datos por alguien que ya conocía el shape
 * exacto). `validarPayload` es la validación de shape/contenido específica
 * por `trigger` — ReglasFiltroService/ReglaEnvioService siguen siendo la
 * única fuente de verdad de qué es evaluable/enviable; esto solo evita que
 * algo inválido llegue a guardarse y falle en silencio semanas después,
 * visible nada más en logs del job/evento.
 */
@Injectable()
export class ReglasService {
  private readonly logger = new Logger(ReglasService.name);

  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly filtroService: ReglasFiltroService,
    private readonly candadoService: ReglaCandadoService,
    private readonly envioService: ReglaEnvioService,
  ) {}

  findAll() {
    return this.tenantPrisma.client.regla.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const regla = await this.tenantPrisma.client.regla.findUnique({ where: { id } });
    if (!regla) {
      throw new NotFoundException('Regla no encontrada');
    }
    return regla;
  }

  async create(dto: CreateReglaDto) {
    const { triggerConfig, filtro, plantillaVariables } = await this.validarPayload({
      trigger: dto.trigger,
      triggerConfigRaw: dto.triggerConfig,
      filtroRaw: dto.filtro ?? [],
      plantillaVariablesRaw: dto.plantillaVariables ?? [],
    });

    return this.tenantPrisma.client.regla.create({
      data: {
        nombre: dto.nombre,
        trigger: dto.trigger,
        triggerConfig: triggerConfig ?? undefined,
        filtro,
        canal: dto.canal ?? 'WHATSAPP',
        plantillaNombre: dto.plantillaNombre,
        plantillaIdioma: dto.plantillaIdioma,
        plantillaCategoria: dto.plantillaCategoria,
        plantillaTexto: dto.plantillaTexto,
        plantillaVariables,
        activa: dto.activa ?? true,
      } as any,
    });
  }

  async update(id: string, dto: UpdateReglaDto) {
    const existente = await this.tenantPrisma.client.regla.findUnique({ where: { id } });
    if (!existente) {
      throw new NotFoundException('Regla no encontrada');
    }

    const trigger = dto.trigger ?? (existente.trigger as ReglaTriggerTipo);
    const cambioDeTrigger = dto.trigger !== undefined && dto.trigger !== existente.trigger;

    // Cambiar de tipo de Trigger limpia lo que ya no aplica (ver casos
    // borde del prompt de esta etapa) en vez de arrastrar un triggerConfig/
    // filtro del tipo anterior que ya no tiene sentido.
    const triggerConfigRaw = dto.triggerConfig ?? (cambioDeTrigger ? undefined : ((existente.triggerConfig as Record<string, unknown> | null) ?? undefined));
    const filtroRaw = dto.filtro ?? (cambioDeTrigger ? [] : ((existente.filtro as unknown[] | null) ?? []));
    const plantillaVariablesRaw = dto.plantillaVariables ?? ((existente.plantillaVariables as unknown[] | null) ?? []);

    const { triggerConfig, filtro, plantillaVariables } = await this.validarPayload({
      trigger,
      triggerConfigRaw,
      filtroRaw,
      plantillaVariablesRaw,
    });

    // Caso borde declarado explícitamente en el prompt: una FECHA_PROGRAMADA
    // que ya se disparó (`disparadaEn` no nulo) se vuelve a armar (se
    // resetea a null) si `fechaHora` cambió respecto al valor guardado, o
    // si el Trigger dejó de ser FECHA_PROGRAMADA (el campo ya no aplica).
    // Si no se tocó fechaHora, `disparadaEn` se deja tal cual — no
    // queremos reactivar un disparo que ya ocurrió solo porque se editó,
    // por ejemplo, el nombre de la Regla.
    let disparadaEn: Date | null | undefined;
    if (existente.disparadaEn) {
      if (trigger !== 'FECHA_PROGRAMADA') {
        disparadaEn = null;
      } else {
        const fechaHoraNueva = (triggerConfig as { fechaHora: string }).fechaHora;
        const fechaHoraVieja = (existente.triggerConfig as { fechaHora?: string } | null)?.fechaHora;
        if (fechaHoraNueva !== fechaHoraVieja) {
          disparadaEn = null;
        }
      }
    }

    try {
      return await this.tenantPrisma.client.regla.update({
        where: { id },
        data: {
          nombre: dto.nombre,
          trigger: dto.trigger,
          triggerConfig,
          filtro,
          canal: dto.canal,
          plantillaNombre: dto.plantillaNombre,
          plantillaIdioma: dto.plantillaIdioma,
          plantillaCategoria: dto.plantillaCategoria,
          plantillaTexto: dto.plantillaTexto,
          plantillaVariables,
          activa: dto.activa,
          disparadaEn,
        } as any,
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Regla no encontrada');
      }
      throw error;
    }
  }

  /**
   * Disparo a demanda de una Regla MANUAL (el hallazgo de esta etapa —
   * ninguna anterior lo conectó). Mismo patrón que
   * ReglaBarridoService.procesarEstadoCliente (Filtro -> por cada Cliente,
   * candado -> envío), pero a demanda y `await`-eado — quien hace clic en
   * "disparar ahora" espera ver el resultado, no un 200 vacío.
   */
  async dispararManual(id: string, tenantId: string): Promise<ResumenDisparoManual> {
    const regla = await this.tenantPrisma.client.regla.findUnique({ where: { id }, include: { tenant: true } });
    if (!regla) {
      throw new NotFoundException('Regla no encontrada');
    }
    if (regla.trigger !== ReglaTriggerTipo.MANUAL) {
      throw new BadRequestException('Solo se puede disparar a demanda una Regla de tipo MANUAL.');
    }
    if (!regla.activa) {
      throw new BadRequestException('Esta Regla está inactiva.');
    }

    const condiciones = regla.filtro as unknown as FiltroCondicion[];
    const clientes = await this.filtroService.evaluar(tenantId, condiciones);

    const resumen: ResumenDisparoManual = {
      clientesMatcheados: clientes.length,
      enviosDisparados: 0,
      bloqueadosPorCandado: 0,
      conError: 0,
    };

    // Secuencial, mismo criterio que ReglaBarridoService/ReglaEventoPedidoService
    // — evita condición de carrera del candado si el Filtro matchea a
    // varios clientes con la misma categoría Marketing.
    for (const cliente of clientes) {
      try {
        const bloqueado = await this.candadoService.estaBloqueado(tenantId, cliente.id, regla.plantillaCategoria);
        if (bloqueado) {
          resumen.bloqueadosPorCandado++;
          continue;
        }
        await this.envioService.enviar(regla.tenant, cliente, regla);
        resumen.enviosDisparados++;
      } catch (error: any) {
        resumen.conError++;
        this.logger.error(
          `Disparo manual de Regla ${regla.id} a Cliente ${cliente.id} (tenant=${tenantId}) falló: ${error?.message ?? error}`,
        );
      }
    }

    return resumen;
  }

  private async validarPayload(input: {
    trigger: ReglaTriggerTipo;
    triggerConfigRaw: Record<string, unknown> | undefined;
    filtroRaw: unknown[];
    plantillaVariablesRaw: unknown[];
  }): Promise<PayloadValidado> {
    const { trigger } = input;

    const triggerConfig = await this.validarTriggerConfig(trigger, input.triggerConfigRaw);

    // El Filtro no aplica a EVENTO_PEDIDO (decisión de producto ya tomada) —
    // se limpia en vez de rechazar, mismo criterio que triggerConfig al
    // cambiar de tipo (ver casos borde del prompt de esta etapa).
    const filtro =
      trigger === ReglaTriggerTipo.EVENTO_PEDIDO ? [] : await this.validarFiltro(input.filtroRaw);

    const plantillaVariables = await this.validarPlantillaVariables(trigger, input.plantillaVariablesRaw);

    return { triggerConfig, filtro, plantillaVariables };
  }

  private async validarTriggerConfig(
    trigger: ReglaTriggerTipo,
    raw: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown> | null> {
    if (trigger === ReglaTriggerTipo.EVENTO_PEDIDO) {
      const instancia = plainToInstance(EventoPedidoTriggerConfigDto, raw ?? {});
      const errores = await validate(instancia, { whitelist: true, forbidNonWhitelisted: true });
      if (errores.length > 0) {
        throw new BadRequestException(this.primerError(errores, 'triggerConfig inválido para EVENTO_PEDIDO'));
      }
      this.assertEstatusValido(instancia.origen, instancia.estatus);
      return { origen: instancia.origen, estatus: instancia.estatus };
    }

    if (trigger === ReglaTriggerTipo.FECHA_PROGRAMADA) {
      const instancia = plainToInstance(FechaProgramadaTriggerConfigDto, raw ?? {});
      const errores = await validate(instancia, { whitelist: true, forbidNonWhitelisted: true });
      if (errores.length > 0) {
        throw new BadRequestException(this.primerError(errores, 'triggerConfig inválido para FECHA_PROGRAMADA'));
      }
      const fecha = new Date(instancia.fechaHora);
      if (fecha.getUTCMinutes() !== 0 || fecha.getUTCSeconds() !== 0 || fecha.getUTCMilliseconds() !== 0) {
        throw new BadRequestException(
          'fechaHora debe ser una hora en punto (minutos y segundos en cero) — el job periódico corre cada hora.',
        );
      }
      return { fechaHora: instancia.fechaHora };
    }

    // ESTADO_CLIENTE / MANUAL: sin triggerConfig.
    return null;
  }

  private assertEstatusValido(origen: ReglaTriggerOrigenPedido, estatus: string) {
    const valores: string[] =
      origen === ReglaTriggerOrigenPedido.ORDER ? Object.values(EstadoPedido) : Object.values(PedidoB2bEstado);
    if (!valores.includes(estatus)) {
      throw new BadRequestException(
        `estatus "${estatus}" no es válido para origen ${origen} (valores válidos: ${valores.join(', ')}).`,
      );
    }
  }

  private async validarFiltro(raw: unknown[]): Promise<unknown[]> {
    return Promise.all(
      raw.map(async (elemento) => {
        const instancia = plainToInstance(FiltroCondicionDto, elemento);
        const errores = await validate(instancia, { whitelist: true, forbidNonWhitelisted: true });
        if (errores.length > 0) {
          throw new BadRequestException(this.primerError(errores, 'Condición de Filtro inválida'));
        }
        // Mismo criterio que ReglasFiltroService.filtroAntiguedad: IGUAL no
        // tiene una interpretación razonable sobre antigüedad en días —
        // rechazado aquí al guardar, no solo al evaluar.
        if (instancia.campo !== ReglaFiltroCampo.TOTAL_PEDIDOS && instancia.operador === ReglaFiltroOperador.IGUAL) {
          throw new BadRequestException(
            `El operador IGUAL no aplica al campo ${instancia.campo} — usa MAYOR_IGUAL o MENOR_IGUAL.`,
          );
        }
        return { campo: instancia.campo, operador: instancia.operador, valor: instancia.valor };
      }),
    );
  }

  private async validarPlantillaVariables(trigger: ReglaTriggerTipo, raw: unknown[]): Promise<unknown[]> {
    return Promise.all(
      raw.map(async (elemento) => {
        const instancia = plainToInstance(PlantillaVariableDto, elemento);
        const errores = await validate(instancia, { whitelist: true, forbidNonWhitelisted: true });
        if (errores.length > 0) {
          throw new BadRequestException(this.primerError(errores, 'Variable de plantilla inválida'));
        }

        if (instancia.fuente === ReglaPlantillaVariableFuente.CAMPO_CLIENTE && instancia.valor !== CAMPO_CLIENTE_SOPORTADO) {
          throw new BadRequestException(
            `Campo de Cliente no soportado: "${instancia.valor}" (solo "${CAMPO_CLIENTE_SOPORTADO}").`,
          );
        }

        if (instancia.fuente === ReglaPlantillaVariableFuente.CAMPO_PEDIDO) {
          if (trigger !== ReglaTriggerTipo.EVENTO_PEDIDO) {
            throw new BadRequestException('Una variable CAMPO_PEDIDO solo es válida si el Trigger es EVENTO_PEDIDO.');
          }
          if (instancia.valor !== CAMPO_PEDIDO_SOPORTADO) {
            throw new BadRequestException(
              `Campo de pedido no soportado: "${instancia.valor}" (solo "${CAMPO_PEDIDO_SOPORTADO}").`,
            );
          }
        }

        return { posicion: instancia.posicion, fuente: instancia.fuente, valor: instancia.valor };
      }),
    );
  }

  private primerError(errores: ValidationError[], fallback: string): string {
    return Object.values(errores[0]?.constraints ?? {})[0] ?? fallback;
  }
}
