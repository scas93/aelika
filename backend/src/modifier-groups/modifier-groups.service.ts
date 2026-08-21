import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CreateModifierGroupDto } from './dto/create-modifier-group.dto';
import { UpdateModifierGroupDto } from './dto/update-modifier-group.dto';
import { CreateModifierOptionDto } from './dto/create-modifier-option.dto';
import { UpdateModifierOptionDto } from './dto/update-modifier-option.dto';
import { AssignModifierGroupDto } from './dto/assign-modifier-group.dto';

const PRISMA_NOT_FOUND = 'P2025';
const PRISMA_FK_CONSTRAINT = 'P2003';

@Injectable()
export class ModifierGroupsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  findAll() {
    return this.tenantPrisma.client.modifierGroup.findMany({
      orderBy: { createdAt: 'desc' },
      include: { opciones: { orderBy: { nombre: 'asc' } } },
    });
  }

  async create(dto: CreateModifierGroupDto) {
    // Not a single nested `opciones: { create: [...] }` write: the
    // tenant-scoped query extension (see TenantPrismaService) only injects
    // tenantId into the root operation's `data`, not into nested creates —
    // a nested ModifierOption row would be written without one. Creating
    // each opcion as its own root-level `modifierOption.create` (same as
    // addOpcion below) goes through the extension correctly instead.
    const group = await this.tenantPrisma.client.modifierGroup.create({
      // tenantId is required by the generated types but injected at runtime
      // by the tenant-scoped query extension.
      data: {
        nombre: dto.nombre,
        tipoSeleccion: dto.tipoSeleccion,
        obligatorio: dto.obligatorio ?? false,
        activo: dto.activo ?? true,
      } as any,
    });

    if (dto.opciones && dto.opciones.length > 0) {
      await this.tenantPrisma.client.modifierOption.createMany({
        data: dto.opciones.map((opcion) => ({
          modifierGroupId: group.id,
          nombre: opcion.nombre,
          precioAdicional: opcion.precioAdicional ?? 0,
          activo: opcion.activo ?? true,
        })) as any,
      });
    }

    return this.tenantPrisma.client.modifierGroup.findUnique({
      where: { id: group.id },
      include: { opciones: true },
    });
  }

  async update(id: string, dto: UpdateModifierGroupDto) {
    try {
      return await this.tenantPrisma.client.modifierGroup.update({
        where: { id },
        data: dto,
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Grupo de modificadores no encontrado');
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      await this.tenantPrisma.client.modifierGroup.delete({ where: { id } });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Grupo de modificadores no encontrado');
      }
      if (error?.code === PRISMA_FK_CONSTRAINT) {
        throw new ConflictException('No puedes eliminar un grupo de modificadores que está asignado a un producto');
      }
      throw error;
    }
  }

  async addOpcion(modifierGroupId: string, dto: CreateModifierOptionDto) {
    await this.assertGroupBelongsToTenant(modifierGroupId);

    return this.tenantPrisma.client.modifierOption.create({
      data: {
        modifierGroupId,
        nombre: dto.nombre,
        precioAdicional: dto.precioAdicional ?? 0,
        activo: dto.activo ?? true,
      } as any,
    });
  }

  async updateOpcion(id: string, dto: UpdateModifierOptionDto) {
    try {
      return await this.tenantPrisma.client.modifierOption.update({
        where: { id },
        data: dto,
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Opción no encontrada');
      }
      throw error;
    }
  }

  /**
   * No referential check on purpose (unlike ModifierGroup/Product/Category):
   * OrderItemModifier snapshots nombre/precioAdicional at order time and its
   * FK to ModifierOption is onDelete: SetNull, so historical orders never
   * depend on this row still existing.
   */
  async removeOpcion(id: string) {
    try {
      await this.tenantPrisma.client.modifierOption.delete({ where: { id } });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Opción no encontrada');
      }
      throw error;
    }
  }

  async assignToProduct(modifierGroupId: string, productId: string, dto: AssignModifierGroupDto) {
    await this.assertGroupBelongsToTenant(modifierGroupId);
    await this.assertProductBelongsToTenant(productId);

    return this.tenantPrisma.client.productModifierGroup.upsert({
      where: { productId_modifierGroupId: { productId, modifierGroupId } },
      create: { productId, modifierGroupId, orden: dto.orden ?? 0 },
      update: { orden: dto.orden ?? 0 },
    });
  }

  async unassignFromProduct(modifierGroupId: string, productId: string) {
    try {
      await this.tenantPrisma.client.productModifierGroup.delete({
        where: { productId_modifierGroupId: { productId, modifierGroupId } },
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Esta asignación no existe');
      }
      throw error;
    }
  }

  /**
   * modifierGroupId arrives as a plain id in the body of assign/unassign —
   * the tenant-scoped extension only guards ModifierGroup when it's the root
   * of the query, not when it's referenced elsewhere. Same principle as
   * ProductsService.assertCategoryBelongsToTenant: 404, never 403, so we
   * never confirm another tenant's resource exists.
   */
  private async assertGroupBelongsToTenant(modifierGroupId: string) {
    const group = await this.tenantPrisma.client.modifierGroup.findUnique({
      where: { id: modifierGroupId },
      select: { id: true },
    });
    if (!group) {
      throw new NotFoundException('Grupo de modificadores no encontrado');
    }
  }

  private async assertProductBelongsToTenant(productId: string) {
    const product = await this.tenantPrisma.client.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }
  }
}
