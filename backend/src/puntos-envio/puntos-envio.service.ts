import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { CreatePuntoEnvioDto } from './dto/create-punto-envio.dto';
import { UpdatePuntoEnvioDto } from './dto/update-punto-envio.dto';

const PRISMA_NOT_FOUND = 'P2025';
const PRISMA_FK_CONSTRAINT = 'P2003';

@Injectable()
export class PuntosEnvioService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  findAll() {
    return this.tenantPrisma.client.puntoEnvio.findMany({
      orderBy: { nombre: 'asc' },
    });
  }

  create(dto: CreatePuntoEnvioDto) {
    return this.tenantPrisma.client.puntoEnvio.create({
      // tenantId is required by the generated types but injected at runtime
      // by the tenant-scoped query extension (see TenantPrismaService).
      data: {
        nombre: dto.nombre,
        direccion: dto.direccion,
        pedidoMinimo: dto.pedidoMinimo,
        activo: dto.activo ?? true,
      } as any,
    });
  }

  async update(id: string, dto: UpdatePuntoEnvioDto) {
    try {
      return await this.tenantPrisma.client.puntoEnvio.update({
        where: { id },
        data: dto,
      });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Punto de envío no encontrado');
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      await this.tenantPrisma.client.puntoEnvio.delete({ where: { id } });
    } catch (error: any) {
      if (error?.code === PRISMA_NOT_FOUND) {
        throw new NotFoundException('Punto de envío no encontrado');
      }
      if (error?.code === PRISMA_FK_CONSTRAINT) {
        throw new ConflictException('No puedes eliminar un punto de envío que tiene pedidos');
      }
      throw error;
    }
  }
}
