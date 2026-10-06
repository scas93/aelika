import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { TipoStorefront } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../common/types/jwt-payload.type';

/**
 * Etapa 2: solo los tenants RETAIL_B2B pueden usar los endpoints de pedidos B2B. Antes de la Etapa 2 nada validaba
 * `Tenant.tipoStorefront` al crear o consultar un pedido B2B (solo se ocultaba la navegación del panel).
 *
 * El tenant se lee con PrismaService crudo (Tenant no es un modelo tenant-owned). Corre después de los guards globales
 * (JWT + roles): una petición sin sesión sigue dando 401 y un rol sin permiso 403 por su propia razón.
 * No cubre el CRUD de códigos de descuento (configuración, no pedidos): fuera de alcance por ahora.
 */

/** Panel (con sesión): 403 si el negocio de la sesión no es de mayoreo. */
@Injectable()
export class TenantB2bPanelGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<Request>().user as JwtPayload | undefined;
    if (!user?.tenantId) return true; // sin sesión ya lo resolvió el guard de JWT
    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { tipoStorefront: true } });
    if (tenant?.tipoStorefront !== TipoStorefront.RETAIL_B2B) {
      throw new ForbiddenException('Los pedidos de mayoreo no están habilitados para este negocio');
    }
    return true;
  }
}

/** Storefront público: 404 con el mismo mensaje que un slug inexistente (no confirma que el negocio existe como otro tipo). */
@Injectable()
export class TenantB2bPublicGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const slug = context.switchToHttp().getRequest<Request>().params?.slug;
    if (typeof slug !== 'string') return true;
    const tenant = await this.prisma.tenant.findUnique({ where: { slug }, select: { tipoStorefront: true } });
    // Slug inexistente: lo resuelve el servicio con su 404 de siempre.
    if (tenant && tenant.tipoStorefront !== TipoStorefront.RETAIL_B2B) {
      throw new NotFoundException('Negocio no encontrado');
    }
    return true;
  }
}
