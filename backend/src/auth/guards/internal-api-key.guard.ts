import { timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

// Single global secret (INTERNAL_API_KEY), unlike BotAuthGuard's per-tenant
// botApiKey — this guard protects server-to-server endpoints that move
// money (Stripe Connect account creation/status), not a per-tenant resource.
// Compared with crypto.timingSafeEqual (not ===) so response time can't leak
// how many leading bytes of the key an attacker guessed correctly.
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('x-api-key');
    const expected = this.configService.get<string>('INTERNAL_API_KEY');

    if (!provided || !expected) {
      throw new UnauthorizedException('Falta el header X-Api-Key');
    }

    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);

    // timingSafeEqual throws on length mismatch instead of returning false —
    // buffers of different lengths are simply not equal, never a valid key.
    const matches =
      providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);

    if (!matches) {
      throw new UnauthorizedException('Llave interna inválida');
    }

    return true;
  }
}
