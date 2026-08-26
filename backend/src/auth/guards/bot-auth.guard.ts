import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

// Server-to-server auth for Botpress: one botApiKey per tenant (not a shared
// secret), sent via X-Api-Key. No JWT/session involved — the key itself
// identifies the business, so there's nothing for RolesGuard to check either
// (routes using this guard must be @Public() to skip both).
@Injectable()
export class BotAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.header('x-api-key');
    if (!apiKey) {
      throw new UnauthorizedException('Falta el header X-Api-Key');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { botApiKey: apiKey },
    });
    if (!tenant) {
      throw new UnauthorizedException('Llave de bot inválida');
    }

    request.tenant = tenant;
    return true;
  }
}
