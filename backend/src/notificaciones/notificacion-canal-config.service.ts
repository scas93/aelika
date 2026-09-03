import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { NotificacionCanalTipo } from '../../generated/prisma/enums';

const PRISMA_NOT_FOUND = 'P2025';

export interface CreateNotificacionCanalConfigInput {
  tipo: NotificacionCanalTipo;
  // Shape depends on `tipo` — see the comment on NotificacionCanalConfig in
  // schema.prisma. Not validated per-shape yet (Fase A has no HTTP layer
  // calling this); the providers landing in the next phase are what will
  // actually read these fields.
  config: Record<string, unknown>;
  activo?: boolean;
}

export interface UpdateNotificacionCanalConfigInput {
  config?: Record<string, unknown>;
  activo?: boolean;
}

/**
 * CRUD for NotificacionCanalConfig — one row per NotificacionCanalTipo per
 * tenant (enforced by the @@unique([tenantId, tipo]) constraint, see
 * schema.prisma). Same shape as PuntosEnvioService: tenant isolation comes
 * for free from TenantPrismaService, no service-level tenantId handling.
 */
@Injectable()
export class NotificacionCanalConfigService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  findAll() {
    return this.tenantPrisma.client.notificacionCanalConfig.findMany({
      orderBy: { tipo: 'asc' },
    });
  }

  async findOne(id: string) {
    const canal = await this.tenantPrisma.client.notificacionCanalConfig.findUnique({ where: { id } });
    if (!canal) {
      throw new NotFoundException('Configuración de canal no encontrada');
    }
    return canal;
  }

  create(dto: CreateNotificacionCanalConfigInput) {
    return this.tenantPrisma.client.notificacionCanalConfig.create({
      // tenantId is required by the generated types but injected at runtime
      // by the tenant-scoped query extension (see TenantPrismaService).
      data: {
        tipo: dto.tipo,
        config: dto.config as any,
        activo: dto.activo ?? true,
      } as any,
    });
  }

  async update(id: string, dto: UpdateNotificacionCanalConfigInput) {
    try {
      return await this.tenantPrisma.client.notificacionCanalConfig.update({
        where: { id },
        data: dto as any,
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Configuración de canal no encontrada');
      }
      throw error;
    }
  }

  /**
   * No FK-conflict handling needed (unlike PuntosEnvioService.remove):
   * NotificacionEventoConfig.canalConfig is onDelete: Cascade — deleting a
   * channel just removes the event rules that pointed at it, on purpose (see
   * schema.prisma comment on that relation).
   */
  async remove(id: string) {
    try {
      await this.tenantPrisma.client.notificacionCanalConfig.delete({ where: { id } });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Configuración de canal no encontrada');
      }
      throw error;
    }
  }
}
