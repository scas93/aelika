import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CreateCodigoDescuentoB2bDto } from './dto/create-codigo-descuento-b2b.dto';
import { UpdateCodigoDescuentoB2bDto } from './dto/update-codigo-descuento-b2b.dto';

const PRISMA_NOT_FOUND = 'P2025';
const PRISMA_UNIQUE_CONSTRAINT = 'P2002';

@Injectable()
export class CodigosDescuentoB2bService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  findAll() {
    return this.tenantPrisma.client.pedidoB2bCodigoDescuento.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateCodigoDescuentoB2bDto) {
    try {
      return await this.tenantPrisma.client.pedidoB2bCodigoDescuento.create({
        // tenantId is required by the generated types but injected at runtime
        // by the tenant-scoped query extension (see TenantPrismaService).
        data: {
          codigo: dto.codigo.trim().toUpperCase(),
          descuentoPorcentaje: dto.descuentoPorcentaje,
          activo: dto.activo ?? true,
        } as any,
      });
    } catch (error: any) {
      if (error?.code === PRISMA_UNIQUE_CONSTRAINT) {
        throw new ConflictException(
          'Ya existe un código de descuento con ese texto',
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateCodigoDescuentoB2bDto) {
    try {
      return await this.tenantPrisma.client.pedidoB2bCodigoDescuento.update({
        where: { id },
        data: {
          codigo:
            dto.codigo !== undefined
              ? dto.codigo.trim().toUpperCase()
              : undefined,
          descuentoPorcentaje: dto.descuentoPorcentaje,
          activo: dto.activo,
        },
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Código de descuento no encontrado');
      }
      if (error?.code === PRISMA_UNIQUE_CONSTRAINT) {
        throw new ConflictException(
          'Ya existe un código de descuento con ese texto',
        );
      }
      throw error;
    }
  }

  /**
   * No referential check needed (unlike PuntoEnvio/ModifierGroup, which use
   * onDelete: Restrict): PedidoB2b already snapshots
   * codigoDescuentoTexto/descuentoPorcentajeAplicado at creation time and its
   * FK to this table is onDelete: SetNull, so deleting a code never loses
   * anything from an existing order's history — same principle as
   * ModifierGroupsService.removeOpcion.
   */
  async remove(id: string) {
    try {
      await this.tenantPrisma.client.pedidoB2bCodigoDescuento.delete({
        where: { id },
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Código de descuento no encontrado');
      }
      throw error;
    }
  }
}
