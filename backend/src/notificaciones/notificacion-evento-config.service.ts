import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { NotificacionAudiencia, NotificacionEvento } from '../../generated/prisma/enums';
import { EVENTO_MAYOREO, esMayoreo, exigirEventoPermitido } from './notificacion-reglas-negocio';

const PRISMA_NOT_FOUND = 'P2025';
const PRISMA_UNIQUE_CONSTRAINT = 'P2002';

export interface CreateNotificacionEventoConfigInput {
  evento: NotificacionEvento;
  audiencia: NotificacionAudiencia;
  canalConfigId: string;
  activo?: boolean;
}

export interface UpdateNotificacionEventoConfigInput {
  activo?: boolean;
  canalConfigId?: string;
}

/**
 * CRUD for NotificacionEventoConfig — which channel(s) get notified for a
 * given (evento, audiencia) pair. This service is only config CRUD; the rows
 * are read elsewhere: NotificacionesProcessor for the order lifecycle events
 * and AvisoPedidoModificadoService for PEDIDO_MODIFICADO_CLIENTE (mayoreo).
 */
@Injectable()
export class NotificacionEventoConfigService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly prisma: PrismaService,
  ) {}

  private async tipoDeNegocio(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { tipoStorefront: true } });
    return t.tipoStorefront;
  }

  /** Mayoreo solo ve su evento: si le quedaron filas viejas de menudeo no se borran, solo no se muestran. */
  async findAll(tenantId: string) {
    const tipo = await this.tipoDeNegocio(tenantId);
    return this.tenantPrisma.client.notificacionEventoConfig.findMany({
      where: esMayoreo(tipo) ? { evento: EVENTO_MAYOREO } : {},
      orderBy: [{ evento: 'asc' }, { audiencia: 'asc' }],
      include: { canalConfig: true },
    });
  }

  async findOne(id: string) {
    const evento = await this.tenantPrisma.client.notificacionEventoConfig.findUnique({
      where: { id },
      include: { canalConfig: true },
    });
    if (!evento) {
      throw new NotFoundException('Configuración de evento no encontrada');
    }
    return evento;
  }

  async create(tenantId: string, dto: CreateNotificacionEventoConfigInput) {
    const canal = await this.assertCanalConfigBelongsToTenant(dto.canalConfigId);
    exigirEventoPermitido(await this.tipoDeNegocio(tenantId), dto.evento, dto.audiencia, canal.tipo);

    try {
      return await this.tenantPrisma.client.notificacionEventoConfig.create({
        // tenantId is required by the generated types but injected at runtime
        // by the tenant-scoped query extension (see TenantPrismaService).
        data: {
          evento: dto.evento,
          audiencia: dto.audiencia,
          canalConfigId: dto.canalConfigId,
          activo: dto.activo ?? true,
        } as any,
      });
    } catch (error: any) {
      if (error?.code === PRISMA_UNIQUE_CONSTRAINT) {
        throw new ConflictException('Ya existe esta combinación de evento, audiencia y canal');
      }
      throw error;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateNotificacionEventoConfigInput) {
    const existente = await this.findOne(id);
    // El canal efectivo tras el cambio (el actual si no se manda otro): se revalida toda la combinación.
    const canal = dto.canalConfigId ? await this.assertCanalConfigBelongsToTenant(dto.canalConfigId) : existente.canalConfig;
    exigirEventoPermitido(await this.tipoDeNegocio(tenantId), existente.evento, existente.audiencia, canal.tipo);

    try {
      return await this.tenantPrisma.client.notificacionEventoConfig.update({
        where: { id },
        data: dto,
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Configuración de evento no encontrada');
      }
      if (error?.code === PRISMA_UNIQUE_CONSTRAINT) {
        throw new ConflictException('Ya existe esta combinación de evento, audiencia y canal');
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      await this.tenantPrisma.client.notificacionEventoConfig.delete({ where: { id } });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Configuración de evento no encontrada');
      }
      throw error;
    }
  }

  /**
   * canalConfigId arrives as a plain id — the tenant-scoped extension only
   * guards NotificacionCanalConfig when it's the root of the query, not when
   * it's referenced elsewhere. Same principle as
   * ProductsService.assertCategoryBelongsToTenant: 404, never 403.
   */
  private async assertCanalConfigBelongsToTenant(canalConfigId: string) {
    const canal = await this.tenantPrisma.client.notificacionCanalConfig.findUnique({
      where: { id: canalConfigId },
      select: { id: true, tipo: true },
    });
    if (!canal) {
      throw new NotFoundException('Configuración de canal no encontrada');
    }
    return canal;
  }
}
