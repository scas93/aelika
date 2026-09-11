import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReglaCandadoService } from './regla-candado.service';
import { ReglaEnvioService } from './regla-envio.service';
import { ReglaTriggerOrigenPedido } from '../../generated/prisma/enums';
import { Regla, Tenant } from '../../generated/prisma/client';

type ReglaConTenant = Regla & { tenant: Tenant };

interface DispararEventoParams {
  tenantId: string;
  origen: ReglaTriggerOrigenPedido;
  estatus: string;
  clienteId: string;
  folio: string;
}

/**
 * Dispara las Reglas EVENTO_PEDIDO que apliquen para un cambio de estatus
 * real de Order/PedidoB2b — llamado desde OrdersService.avanzar y
 * PedidosB2bService.avanzar/marcarPagado (ver esos archivos). El Filtro no
 * aplica a EVENTO_PEDIDO (decisión de producto ya confirmada): el
 * destinatario es siempre el Cliente dueño del pedido, resuelto directo por
 * clienteId — no hay condición que evaluar (ReglasFiltroService no se usa
 * aquí). El candado de frecuencia sí sigue aplicando (ReglaCandadoService,
 * sin cambios ahí).
 *
 * `dispararSeguro` nunca lanza — mismo principio que
 * NotificacionesQueueService.encolarSeguro: el caller debe invocarlo con
 * `void` (fire-and-forget), nunca `await`, para no sumarle al request HTTP
 * de avanzar/marcar-pagado la latencia del POST a Botpress que hace
 * ReglaEnvioService por debajo (a diferencia de encolarSeguro, que solo
 * encola en BullMQ y no hace la llamada de red en el mismo proceso, aquí sí
 * se hace directo — por eso el fire-and-forget importa más todavía).
 */
@Injectable()
export class ReglaEventoPedidoService {
  private readonly logger = new Logger(ReglaEventoPedidoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly candadoService: ReglaCandadoService,
    private readonly envioService: ReglaEnvioService,
  ) {}

  async dispararSeguro(params: DispararEventoParams): Promise<void> {
    try {
      const reglas = (await this.prisma.regla.findMany({
        where: {
          tenantId: params.tenantId,
          trigger: 'EVENTO_PEDIDO',
          activa: true,
          AND: [
            { triggerConfig: { path: ['origen'], equals: params.origen } },
            { triggerConfig: { path: ['estatus'], equals: params.estatus } },
          ],
        },
        include: { tenant: true },
      })) as ReglaConTenant[];

      if (reglas.length === 0) return;

      const cliente = await this.prisma.cliente.findUnique({ where: { id: params.clienteId } });
      if (!cliente) {
        this.logger.warn(
          `EVENTO_PEDIDO: Cliente ${params.clienteId} no encontrado (tenant=${params.tenantId}) — se omite, ` +
            `${reglas.length} Regla(s) que hubieran aplicado no se disparan.`,
        );
        return;
      }

      // Secuencial a propósito, mismo criterio que ReglaBarridoService: si
      // dos Reglas Marketing distintas aplican al mismo evento (caso borde
      // del prompt), la segunda debe ver el ReglaEnvioLog que dejó la
      // primera al revisar el candado.
      for (const regla of reglas) {
        try {
          const bloqueado = await this.candadoService.estaBloqueado(regla.tenant, cliente.id, regla.plantillaCategoria);
          if (bloqueado) {
            this.logger.log(
              `EVENTO_PEDIDO: Regla ${regla.id} bloqueada por candado para Cliente ${cliente.id} (tenant=${params.tenantId}).`,
            );
            continue;
          }

          await this.envioService.enviar(regla.tenant, cliente, regla, { folio: params.folio });
        } catch (error: any) {
          this.logger.error(
            `EVENTO_PEDIDO: error disparando Regla ${regla.id} para Cliente ${cliente.id} (tenant=${params.tenantId}, ` +
              `origen=${params.origen}, estatus=${params.estatus}): ${error?.message ?? error}`,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `EVENTO_PEDIDO: error resolviendo Reglas para tenant=${params.tenantId} origen=${params.origen} ` +
          `estatus=${params.estatus}: ${error?.message ?? error}`,
      );
    }
  }
}
