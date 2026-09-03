import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { NotificacionAudiencia, NotificacionEvento } from '../../generated/prisma/enums';

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
 * given (evento, audiencia) pair. Nothing reads or triggers these rows yet
 * (Fase A is data-model only, see CLAUDE.md) — this is purely config.
 */
@Injectable()
export class NotificacionEventoConfigService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  findAll() {
    return this.tenantPrisma.client.notificacionEventoConfig.findMany({
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

  async create(dto: CreateNotificacionEventoConfigInput) {
    await this.assertCanalConfigBelongsToTenant(dto.canalConfigId);

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

  async update(id: string, dto: UpdateNotificacionEventoConfigInput) {
    if (dto.canalConfigId) {
      await this.assertCanalConfigBelongsToTenant(dto.canalConfigId);
    }

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
      select: { id: true },
    });
    if (!canal) {
      throw new NotFoundException('Configuración de canal no encontrada');
    }
  }
}
