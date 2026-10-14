import { Prisma } from '../../generated/prisma/client';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const PRISMA_NOT_FOUND = 'P2025';

/** Código de un error conocido de Prisma (P2002, P2025...), o undefined si no lo es. */
function codigoPrisma(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

@Injectable()
export class ProductsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  findAll(categoryId?: string) {
    return this.tenantPrisma.client.product.findMany({
      where: categoryId ? { categoryId } : undefined,
      orderBy: { nombre: 'asc' },
    });
  }

  /**
   * Includes `category` (for the read-only header on the product detail
   * page) and `modifierGroups` — the ProductModifierGroup join rows for this
   * product, each with its ModifierGroup nested — ordered by `orden`, so the
   * "modificadores asignados" list doesn't need a second request.
   */
  async findOne(id: string) {
    const product = await this.tenantPrisma.client.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, nombre: true } },
        modifierGroups: {
          orderBy: { orden: 'asc' },
          include: { modifierGroup: { include: { opciones: true } } },
        },
      },
    });
    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }
    return product;
  }

  async create(dto: CreateProductDto) {
    await this.assertCategoryBelongsToTenant(dto.categoryId);

    try {
      return await this.tenantPrisma.client.product.create({
        // tenantId is required by the generated types but injected at runtime
        // by the tenant-scoped query extension (see TenantPrismaService).
        data: {
          nombre: dto.nombre,
          descripcion: dto.descripcion,
          precio: dto.precio,
          categoryId: dto.categoryId,
          fotoUrl: dto.fotoUrl,
          disponible: dto.disponible ?? true,
          erpId: dto.erpId ?? null,
        } as unknown as Prisma.ProductUncheckedCreateInput,
      });
    } catch (error: unknown) {
      this.rethrowErpIdDuplicado(error);
      throw error;
    }
  }

  async update(id: string, dto: UpdateProductDto) {
    if (dto.categoryId) {
      await this.assertCategoryBelongsToTenant(dto.categoryId);
    }

    try {
      return await this.tenantPrisma.client.product.update({
        where: { id },
        data: dto,
      });
    } catch (error: unknown) {
      if (codigoPrisma(error) === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Producto no encontrado');
      }
      this.rethrowErpIdDuplicado(error);
      throw error;
    }
  }

  /** @@unique([tenantId, erpId]): dos productos del mismo negocio no pueden compartir ID del ERP. */
  private rethrowErpIdDuplicado(error: unknown) {
    if (codigoPrisma(error) === 'P2002') {
      throw new ConflictException('Ya existe otro producto con ese ID del ERP');
    }
  }

  async remove(id: string) {
    await this.assertNotInActivePromotion(id);

    try {
      await this.tenantPrisma.client.product.delete({ where: { id } });
    } catch (error: unknown) {
      if (codigoPrisma(error) === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Producto no encontrado');
      }
      throw error;
    }
  }

  /**
   * `Promotion.config` references products by id inside a JSON blob, not a
   * real Prisma FK, so Postgres won't block deleting a product that's still
   * referenced by an active promotion (unlike Product -> Category, which has
   * a real FK with onDelete: Restrict). Check for it explicitly.
   */
  private async assertNotInActivePromotion(productId: string) {
    const referencingPromotion =
      await this.tenantPrisma.client.promotion.findFirst({
        where: {
          activa: true,
          OR: [
            { config: { path: ['productId'], equals: productId } },
            { config: { path: ['productIds'], array_contains: productId } },
          ],
        },
        select: { id: true },
      });

    if (referencingPromotion) {
      throw new ConflictException(
        'No puedes eliminar un producto que está en una promoción activa',
      );
    }
  }

  /**
   * A Product's categoryId is a foreign key that could point to any Category
   * row regardless of tenant — the tenant-scoped extension only guards the
   * Product row itself, not the FK target. This lookup goes through the same
   * tenant-scoped client, so it only succeeds if the category belongs to the
   * requesting tenant; otherwise we 404 instead of leaking that a category
   * exists under a different tenant.
   */
  private async assertCategoryBelongsToTenant(categoryId: string) {
    const category = await this.tenantPrisma.client.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Categoría no encontrada');
    }
  }
}
