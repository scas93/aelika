import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cliente, Regla, ReglaEnvioLog, Tenant } from '../../generated/prisma/client';
import { ReglaPlantillaVariableFuente } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { buildStorefrontUrl } from '../common/storefront-url';
import { PedidoContexto, PlantillaVariable } from './plantilla-variable.type';
import { buscarEnCatalogo, disponibleParaContexto } from './plantilla-variable-catalogo';
import { sanitizarParaMeta } from './plantilla-variable-formato';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

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

  /**
   * Resuelve cada variable contra CATALOGO_VARIABLES (fuente única — ver ese
   * archivo). VALOR_FIJO es la única fuente sin entrada en el catálogo: su
   * "resolución" es el literal tal cual. Todo valor resuelto —incluido
   * VALOR_FIJO— pasa por sanitizarParaMeta antes de mandarse a Botpress, así
   * que ningún envío sale con un parámetro vacío, con saltos de línea/tabs,
   * o con más de 4 espacios seguidos (restricciones de plantillas de Meta).
   */
  private resolverVariables(
    plantillaVariables: PlantillaVariable[],
    tenant: Tenant,
    cliente: Cliente,
    contexto: PedidoContexto | undefined,
  ): string[] {
    const ahora = new Date();
    const storefrontUrl = buildStorefrontUrl(this.configService, tenant.slug);

    return [...plantillaVariables]
      .sort((a, b) => a.posicion - b.posicion)
      .map((variable) => {
        if (variable.fuente === ReglaPlantillaVariableFuente.VALOR_FIJO) {
          return sanitizarParaMeta(variable.valor, '—');
        }

        const definicion = buscarEnCatalogo(variable.fuente, variable.valor);
        if (!definicion) {
          throw new BadRequestException(
            `Variable de plantilla no reconocida: fuente=${variable.fuente}, valor="${variable.valor}".`,
          );
        }

        if (!disponibleParaContexto(definicion.restriccion, contexto)) {
          throw new BadRequestException(
            `La variable "${definicion.label}" no aplica a este envío (${
              definicion.restriccion.tipo === 'ninguna' ? 'sin restricción' : definicion.restriccion.motivo
            }).`,
          );
        }

        const valor = definicion.resolver({ tenant, cliente, contexto, ahora, storefrontUrl });
        return sanitizarParaMeta(valor ?? '', definicion.fallback);
      });
  }
}
