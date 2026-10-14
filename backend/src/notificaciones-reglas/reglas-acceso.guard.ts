import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Role, TipoStorefront } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../common/types/jwt-payload.type';

/**
 * Acceso al módulo Notificaciones (reglas): el Dueño siempre; el Gerente solo en tenants RETAIL_B2B (docs/diseno-operacion.md,
 * "Módulos de la plataforma"); el Operador nunca. En RETAIL_B2C sigue siendo solo Dueño. Los canales y eventos de
 * notificación (Ajustes) siguen siendo solo Dueño en todos los tenants.
 */
@Injectable()
export class ReglasAccesoGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<Request>().user as JwtPayload | undefined;
    const denegar = () => new ForbiddenException('No tienes permiso para realizar esta acción');
    if (!user) throw denegar();
    if (user.rol === Role.DUENO) return true;
    if (user.rol !== Role.GERENTE) throw denegar();
    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { tipoStorefront: true } });
    if (tenant?.tipoStorefront !== TipoStorefront.RETAIL_B2B) throw denegar();
    return true;
  }
}
