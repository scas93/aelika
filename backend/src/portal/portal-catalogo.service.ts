import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { SesionValida } from './portal-acceso.service';

/**
 * GET /portal/catalogo (4d): catálogo vigente para el cliente activo de la sesión. Un solo precio para todos los clientes
 * (precio de lista, IVA incluido); el descuento del cliente se aplica al TOTAL del pedido, no por producto, así que aquí
 * solo se informa su porcentaje. Reemplaza al catálogo público de mayoreo (cerrado en esta entrega).
 * No expone `erpId` ni ids de nada que no sea el producto/categoría que el cliente necesita para pedir.
 */
@Injectable()
export class PortalCatalogoService {
  constructor(private readonly prisma: PrismaService) {}

  async catalogo(sesion: SesionValida) {
    if (!sesion.cliente)
      throw new ConflictException('Elige un cliente para ver el catálogo');
    const t = sesion.tenant;
    const cliente = await this.prisma.cliente.findFirstOrThrow({
      where: { id: sesion.cliente.id, tenantId: t.id },
      select: { descuentoPorcentaje: true },
    });

    // Solo productos disponibles de categorías activas: es un pedido de abasto a futuro, no hay "agotado con badge".
    const categories = await this.prisma.category.findMany({
      where: {
        tenantId: t.id,
        activa: true,
        products: { some: { tenantId: t.id, disponible: true } },
      },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      select: {
        id: true,
        nombre: true,
        products: {
          where: { tenantId: t.id, disponible: true },
          orderBy: { nombre: 'asc' },
          select: {
            id: true,
            nombre: true,
            descripcion: true,
            precio: true,
            fotoUrl: true,
          },
        },
      },
    });

    return {
      cliente: sesion.cliente,
      descuentoPorcentaje: cliente.descuentoPorcentaje
        ? Number(cliente.descuentoPorcentaje)
        : 0,
      minimoPiezas: t.pedidoB2bMinimoPiezas,
      categories: categories.map((c) => ({
        ...c,
        products: c.products.map((p) => ({ ...p, precio: Number(p.precio) })),
      })),
    };
  }
}
