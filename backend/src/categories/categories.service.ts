import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

const PRISMA_NOT_FOUND = 'P2025';
const PRISMA_FK_CONSTRAINT = 'P2003';

@Injectable()
export class CategoriesService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  findAll() {
    // _count.products lets the panel disable "Eliminar" for non-empty
    // categories without an extra request per row — the DELETE endpoint's
    // 409 stays the real source of truth if this count goes stale (e.g. a
    // product was added after this list loaded).
    return this.tenantPrisma.client.category.findMany({
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
  }

  async create(dto: CreateCategoryDto) {
    let orden = dto.orden;
    if (orden === undefined) {
      const last = await this.tenantPrisma.client.category.findFirst({
        orderBy: { orden: 'desc' },
        select: { orden: true },
      });
      orden = (last?.orden ?? -1) + 1;
    }

    return this.tenantPrisma.client.category.create({
      // tenantId is required by the generated types but injected at runtime
      // by the tenant-scoped query extension (see TenantPrismaService).
      data: { nombre: dto.nombre, orden, activa: dto.activa ?? true } as any,
    });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    try {
      return await this.tenantPrisma.client.category.update({
        where: { id },
        data: dto,
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Categoría no encontrada');
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      await this.tenantPrisma.client.category.delete({ where: { id } });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Categoría no encontrada');
      }
      if (error?.code === PRISMA_FK_CONSTRAINT) {
        throw new ConflictException('No puedes eliminar una categoría que tiene productos');
      }
      throw error;
    }
  }
}
