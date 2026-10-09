import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './types/jwt-payload.type';

/** Módulos opcionales que un negocio puede tener apagados (`Tenant.modulosDesactivados`). Vacío = todo encendido. */
export const MODULOS = ['LEALTAD', 'CODIGOS_DESCUENTO'] as const;
export type Modulo = (typeof MODULOS)[number];

export const moduloActivo = (desactivados: readonly string[] | null | undefined, modulo: Modulo) =>
  !(desactivados ?? []).includes(modulo);

/** Un pedido con código de descuento se rechaza (no se ignora en silencio) si el módulo está apagado para el negocio. */
export function assertCodigosDescuentoPermitidos(desactivados: readonly string[] | null | undefined, codigo: string | null | undefined) {
  if (codigo?.trim() && !moduloActivo(desactivados, 'CODIGOS_DESCUENTO')) {
    throw new BadRequestException('Los códigos de descuento no están habilitados para este negocio');
  }
}

const MODULO_KEY = 'modulo';
/** Marca un controller o ruta como parte de un módulo apagable; lo hace cumplir ModuloActivoGuard. */
export const RequiereModulo = (modulo: Modulo) => SetMetadata(MODULO_KEY, modulo);

/**
 * Con el módulo apagado para el negocio: 404 en rutas públicas (resuelven el negocio por `:slug`, mismo mensaje que un
 * negocio inexistente) y 403 en rutas del panel (negocio de la sesión). Corre después de los guards globales (JWT + roles).
 */
@Injectable()
export class ModuloActivoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const modulo = this.reflector.getAllAndOverride<Modulo | undefined>(MODULO_KEY, [context.getHandler(), context.getClass()]);
    if (!modulo) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const slug = req.params?.slug;
    if (typeof slug === 'string') {
      const tenant = await this.prisma.tenant.findUnique({ where: { slug }, select: { modulosDesactivados: true } });
      // Negocio inexistente: lo resuelve el servicio con su 404 de siempre.
      if (tenant && !moduloActivo(tenant.modulosDesactivados, modulo)) throw new NotFoundException('Negocio no encontrado');
      return true;
    }
    const user = req.user as JwtPayload | undefined;
    if (!user?.tenantId) return true; // sin sesión ya lo resolvió el guard de JWT
    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { modulosDesactivados: true } });
    if (tenant && !moduloActivo(tenant.modulosDesactivados, modulo)) {
      throw new ForbiddenException('Este módulo no está habilitado para este negocio');
    }
    return true;
  }
}
