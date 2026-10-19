import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../../common/types/jwt-payload.type';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  /**
   * El token solo identifica al usuario; el estado vigente sale de la base en cada petición (una lectura por llave
   * primaria): un usuario desactivado, borrado o de otro tenant pierde el acceso de inmediato (401), y el rol que se
   * aplica es el actual, no el que traía el token al emitirse.
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { rol: true, activo: true, tenantId: true, email: true },
    });
    if (!user || !user.activo || user.tenantId !== payload.tenantId) {
      throw new UnauthorizedException('Tu sesión ya no es válida. Inicia sesión de nuevo.');
    }
    return { sub: payload.sub, tenantId: user.tenantId, email: user.email, rol: user.rol };
  }
}
