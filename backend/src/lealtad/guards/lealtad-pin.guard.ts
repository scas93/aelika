import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../common/types/jwt-payload.type';

const INTENTOS_MAXIMOS = 5;
const BLOQUEO_MINUTOS = 5;

/**
 * Verifica el PIN de Lealtad (Tenant.pinLealtad, hasheado con bcrypt) en
 * cada request a un endpoint protegido — no hay sesión ni caché de
 * pantalla, el PIN viaja en el body (`VerificacionPinDto.pin`) de cada
 * llamada. Corre DESPUÉS de JwtAuthGuard/RolesGuard (globales vía
 * APP_GUARD) — es una capa extra sobre una ruta ya autenticada, no un
 * reemplazo del login ni un guard tipo BotAuthGuard (que resuelve el
 * tenant desde cero sin JWT).
 *
 * Rate-limiting persistido en Tenant.pinIntentosFallidos/pinBloqueadoHasta
 * (no en memoria/Redis) para sobrevivir un reinicio del backend y
 * funcionar igual si algún día corren varias instancias — ver comentario
 * de esos campos en schema.prisma.
 */
@Injectable()
export class LealtadPinGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as JwtPayload | undefined;
    if (!user?.tenantId) {
      throw new UnauthorizedException('No se encontró el tenant en la sesión');
    }

    const pin = request.body?.pin;
    if (!pin || typeof pin !== 'string') {
      throw new BadRequestException('Falta el PIN');
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
    });

    if (!tenant.pinLealtad) {
      throw new BadRequestException(
        'Este negocio no tiene configurado un PIN de Lealtad todavía.',
      );
    }

    // Un bloqueo ya vencido se trata como si no existiera — no hace falta
    // esperar a un intento fallido nuevo para "limpiarlo" en DB, el próximo
    // intento (correcto o no) ya parte de cero.
    const bloqueadoVigente =
      tenant.pinBloqueadoHasta && tenant.pinBloqueadoHasta > new Date();
    if (bloqueadoVigente) {
      throw new ForbiddenException(
        'PIN bloqueado temporalmente por demasiados intentos fallidos. Intenta de nuevo en unos minutos.',
      );
    }

    const valido = await bcrypt.compare(pin, tenant.pinLealtad);

    if (!valido) {
      const intentosPrevios = tenant.pinBloqueadoHasta ? 0 : tenant.pinIntentosFallidos;
      const intentos = intentosPrevios + 1;
      const bloqueado = intentos >= INTENTOS_MAXIMOS;
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          pinIntentosFallidos: bloqueado ? 0 : intentos,
          pinBloqueadoHasta: bloqueado
            ? new Date(Date.now() + BLOQUEO_MINUTOS * 60_000)
            : null,
        },
      });
      throw new UnauthorizedException('PIN incorrecto');
    }

    if (tenant.pinIntentosFallidos !== 0 || tenant.pinBloqueadoHasta !== null) {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { pinIntentosFallidos: 0, pinBloqueadoHasta: null },
      });
    }

    return true;
  }
}
