import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { PromotionTipo } from '../../generated/prisma/enums';
import { CreatePromotionDto } from './dto/create-promotion.dto';
import { UpdatePromotionDto } from './dto/update-promotion.dto';
import { DescuentoProductoConfigDto } from './dto/descuento-producto-config.dto';
import { ComboConfigDto } from './dto/combo-config.dto';

const PRISMA_NOT_FOUND = 'P2025';

@Injectable()
export class PromotionsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  findAll() {
    return this.tenantPrisma.client.promotion.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreatePromotionDto) {
    const config = await this.parseConfig(dto.tipo, dto.config);
    const productIds = this.extractProductIds(dto.tipo, config);
    await this.assertProductsBelongToTenant(productIds);

    const activa = dto.activa ?? true;
    if (activa) {
      await this.assertProductsNotInOtherActivePromotion(productIds);
    }

    return this.tenantPrisma.client.promotion.create({
      // tenantId is required by the generated types but injected at runtime
      // by the tenant-scoped query extension (see TenantPrismaService).
      data: { tipo: dto.tipo, config: config as object, activa } as any,
    });
  }

  async update(id: string, dto: UpdatePromotionDto) {
    const existing = await this.tenantPrisma.client.promotion.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Promoción no encontrada');
    }

    const tipo = dto.tipo ?? (existing.tipo as PromotionTipo);
    let config: DescuentoProductoConfigDto | ComboConfigDto;

    if (dto.config) {
      config = await this.parseConfig(tipo, dto.config);
      const productIds = this.extractProductIds(tipo, config);
      await this.assertProductsBelongToTenant(productIds);
    } else if (dto.tipo && dto.tipo !== existing.tipo) {
      throw new BadRequestException('Debes enviar `config` al cambiar el tipo de promoción');
    } else {
      config = existing.config as unknown as DescuentoProductoConfigDto | ComboConfigDto;
    }

    const activa = dto.activa ?? existing.activa;
    if (activa) {
      const productIds = this.extractProductIds(tipo, config);
      await this.assertProductsNotInOtherActivePromotion(productIds, id);
    }

    try {
      return await this.tenantPrisma.client.promotion.update({
        where: { id },
        data: { tipo: dto.tipo, config: dto.config ? (config as object) : undefined, activa: dto.activa },
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Promoción no encontrada');
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      await this.tenantPrisma.client.promotion.delete({ where: { id } });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Promoción no encontrada');
      }
      throw error;
    }
  }

  private async parseConfig(
    tipo: PromotionTipo,
    raw: Record<string, unknown>,
  ): Promise<DescuentoProductoConfigDto | ComboConfigDto> {
    const instance: DescuentoProductoConfigDto | ComboConfigDto =
      tipo === PromotionTipo.DESCUENTO_PRODUCTO
        ? plainToInstance(DescuentoProductoConfigDto, raw)
        : plainToInstance(ComboConfigDto, raw);
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });

    if (errors.length > 0) {
      const message = Object.values(errors[0].constraints ?? {})[0] ?? 'La configuración de la promoción es inválida';
      throw new BadRequestException(message);
    }

    return instance;
  }

  private extractProductIds(tipo: PromotionTipo, config: DescuentoProductoConfigDto | ComboConfigDto): string[] {
    return tipo === PromotionTipo.DESCUENTO_PRODUCTO
      ? [(config as DescuentoProductoConfigDto).productId]
      : (config as ComboConfigDto).productIds;
  }

  /**
   * `productId`/`productIds` inside `config` are references embedded in a
   * JSON blob, not a real Prisma FK — Postgres won't stop you from pointing
   * them at another tenant's product. This lookup goes through the
   * tenant-scoped client, so it only succeeds for products that belong to
   * the requesting tenant; otherwise we 404 instead of leaking that a
   * product exists under a different tenant.
   */
  private async assertProductsBelongToTenant(productIds: string[]) {
    const found = await this.tenantPrisma.client.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    });

    if (found.length !== productIds.length) {
      throw new NotFoundException('Uno o más productos no existen en este negocio');
    }
  }

  /**
   * A product can only be covered by one active promotion at a time —
   * otherwise checkout math (which combo/descuento applies to a given unit)
   * becomes ambiguous. Checked against every other active promotion of the
   * tenant, excluding the one being updated (if any).
   */
  private async assertProductsNotInOtherActivePromotion(productIds: string[], excludeId?: string) {
    const activePromotions = await this.tenantPrisma.client.promotion.findMany({
      where: { activa: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { tipo: true, config: true },
    });

    const covered = new Set<string>();
    for (const promo of activePromotions) {
      for (const id of this.extractProductIds(
        promo.tipo as PromotionTipo,
        promo.config as unknown as DescuentoProductoConfigDto | ComboConfigDto,
      )) {
        covered.add(id);
      }
    }

    if (productIds.some((id) => covered.has(id))) {
      throw new ConflictException('Uno o más productos ya están en otra promoción activa');
    }
  }
}
