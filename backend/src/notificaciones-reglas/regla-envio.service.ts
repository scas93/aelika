import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cliente, Regla, ReglaEnvioLog, Tenant } from '../../generated/prisma/client';
import { ReglaPlantillaVariableFuente } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  CAMPO_CLIENTE_SOPORTADO,
  CAMPO_PEDIDO_SOPORTADO,
  NOMBRE_NEGOCIO_SOPORTADO,
  PedidoContexto,
  PlantillaVariable,
} from './plantilla-variable.type';

// Todos los tenants piloto operan en México — mismo supuesto ya hardcodeado
// en backend/src/common/horario.ts (America/Mexico_City). Cliente.telefono
// guarda solo los 10 dígitos nacionales (ver common/telefono.ts), sin
// código de país, así que hay que anteponerlo aquí antes de mandarlo a
// Botpress/Meta, que sí lo requieren en el número.
const LADA_PAIS = '+52';

/**
 * Dispara el envío de WhatsApp de una Regla ya evaluada/filtrada por los
 * servicios de la Etapa 1 (este servicio no repite esa lógica, ni decide
 * el candado de frecuencia — eso es responsabilidad del caller, ver
 * ReglaCandadoService). Construye el payload y hace el POST a la
 * integración Webhook de Botpress (card "Start Conversation") — ese POST
 * solo dispara el workflow ahí, no espera a que termine; el resultado real
 * (éxito/fallo de validación de plantilla contra Meta) llega después por
 * el endpoint de callback (ver RegistraEnvioCallbackController).
 */
@Injectable()
export class ReglaEnvioService {
  private readonly logger = new Logger(ReglaEnvioService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `contexto` (folio del pedido) solo aplica a Reglas EVENTO_PEDIDO con
   * variables CAMPO_PEDIDO — ver PedidoContexto. Omitirlo es válido para
   * cualquier otro trigger; si la Regla sí referencia CAMPO_PEDIDO pero no
   * se pasó contexto, `resolverVariables` lo rechaza explícito (ver abajo).
   */
  async enviar(tenant: Tenant, cliente: Cliente, regla: Regla, contexto?: PedidoContexto): Promise<ReglaEnvioLog> {
    if (!tenant.botWebhookUrl) {
      throw new BadRequestException(
        `El tenant ${tenant.id} no tiene configurada la URL del webhook de Botpress (Tenant.botWebhookUrl) — no se puede enviar.`,
      );
    }

    const variables = this.resolverVariables(regla.plantillaVariables as unknown as PlantillaVariable[], tenant, cliente, contexto);

    // Se crea ANTES del POST (estado EN_CURSO por default, ver schema.prisma)
    // para poder correlacionar la respuesta asíncrona de Botpress — su id
    // viaja en el payload como `correlacionId` y debe volver tal cual en el
    // callback (ver RegistraEnvioCallbackController). También es, desde este
    // momento, lo que ReglaCandadoService cuenta para el candado de
    // frecuencia — un intento en curso ya cuenta, sin importar el resultado
    // final (decisión confirmada explícitamente para esta etapa).
    const log = await this.prisma.reglaEnvioLog.create({
      data: {
        tenantId: tenant.id,
        clienteId: cliente.id,
        reglaId: regla.id,
        categoria: regla.plantillaCategoria,
      },
    });

    const payload = {
      correlacionId: log.id,
      telefono: `${LADA_PAIS}${cliente.telefono}`,
      plantilla: { nombre: regla.plantillaNombre, idioma: regla.plantillaIdioma },
      variables,
    };

    try {
      const response = await fetch(tenant.botWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tenant.botWebhookSecret ? { 'x-bp-secret': tenant.botWebhookSecret } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const detalle = await response.text().catch(() => `HTTP ${response.status}`);
        this.logger.warn(
          `Botpress rechazó el POST inicial para ReglaEnvioLog ${log.id} (tenant=${tenant.id}): ${detalle}`,
        );
        return this.prisma.reglaEnvioLog.update({ where: { id: log.id }, data: { estado: 'FALLO' } });
      }

      this.logger.log(`POST a Botpress aceptado para ReglaEnvioLog ${log.id} (tenant=${tenant.id}) — en curso.`);
      return log;
    } catch (error: any) {
      this.logger.error(
        `Error de red mandando ReglaEnvioLog ${log.id} (tenant=${tenant.id}) a Botpress: ${error?.message ?? error}`,
      );
      return this.prisma.reglaEnvioLog.update({ where: { id: log.id }, data: { estado: 'FALLO' } });
    }
  }

  /**
   * Aplica el resultado que reporta Botpress por el callback asíncrono (ver
   * RegistraEnvioCallbackController). `tenantId` viene de `BotAuthGuard`
   * (`request.tenant.id`), no del body — el id del log viaja por un canal
   * externo (Botpress), así que se valida explícito que pertenezca a ese
   * tenant antes de tocarlo (404 si no, mismo criterio que cualquier FK
   * recibida desde fuera de una sesión — no confirmar la existencia de un
   * registro de otro tenant).
   *
   * Un log que ya salió de EN_CURSO (callback duplicado — Botpress puede
   * reintentar la entrega del webhook) es un no-op silencioso: se regresa
   * el estado actual tal cual, sin volver a escribirlo ni fallar. Esto es
   * deliberado, no un caso sin resolver — un callback repetido no debe
   * romper nada.
   */
  async actualizarEstadoDesdeCallback(
    tenantId: string,
    logId: string,
    estado: 'EXITO' | 'FALLO',
  ): Promise<ReglaEnvioLog> {
    const log = await this.prisma.reglaEnvioLog.findFirst({ where: { id: logId, tenantId } });
    if (!log) {
      throw new NotFoundException(`No se encontró el envío ${logId} para este tenant.`);
    }

    if (log.estado !== 'EN_CURSO') {
      this.logger.log(
        `Callback repetido para ReglaEnvioLog ${logId} (tenant=${tenantId}) — ya estaba en estado ${log.estado}, se ignora.`,
      );
      return log;
    }

    return this.prisma.reglaEnvioLog.update({ where: { id: logId }, data: { estado } });
  }

  private resolverVariables(
    plantillaVariables: PlantillaVariable[],
    tenant: Tenant,
    cliente: Cliente,
    contexto: PedidoContexto | undefined,
  ): string[] {
    return [...plantillaVariables]
      .sort((a, b) => a.posicion - b.posicion)
      .map((variable) => {
        if (variable.fuente === ReglaPlantillaVariableFuente.VALOR_FIJO) {
          return variable.valor;
        }

        if (variable.fuente === ReglaPlantillaVariableFuente.CAMPO_PEDIDO) {
          if (!contexto) {
            throw new BadRequestException(
              'Esta Regla usa una variable CAMPO_PEDIDO pero no hay pedido de contexto — solo aplica a Reglas EVENTO_PEDIDO.',
            );
          }
          if (variable.valor !== CAMPO_PEDIDO_SOPORTADO) {
            throw new BadRequestException(
              `Campo de pedido no soportado como variable de plantilla en esta etapa: "${variable.valor}" (solo "${CAMPO_PEDIDO_SOPORTADO}").`,
            );
          }
          return contexto.folio;
        }

        if (variable.fuente === ReglaPlantillaVariableFuente.NOMBRE_NEGOCIO) {
          if (variable.valor !== NOMBRE_NEGOCIO_SOPORTADO) {
            throw new BadRequestException(
              `Valor no soportado para NOMBRE_NEGOCIO: "${variable.valor}" (solo "${NOMBRE_NEGOCIO_SOPORTADO}").`,
            );
          }
          return tenant.nombre;
        }

        if (variable.valor !== CAMPO_CLIENTE_SOPORTADO) {
          throw new BadRequestException(
            `Campo de Cliente no soportado como variable de plantilla en esta etapa: "${variable.valor}" (solo "${CAMPO_CLIENTE_SOPORTADO}").`,
          );
        }

        return cliente.nombre;
      });
  }
}
