import { Controller, Get, UseGuards } from '@nestjs/common';
import { InternalService } from './internal.service';
import { Public } from '../auth/decorators/public.decorator';
import { BotAuthGuard } from '../auth/guards/bot-auth.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { Tenant } from '../../generated/prisma/client';

// @Public() skips the global JwtAuthGuard/RolesGuard (there's no user/rol
// here) — BotAuthGuard is the real authentication for this controller,
// resolving the tenant from X-Api-Key instead of a JWT.
@Public()
@UseGuards(BotAuthGuard)
@Controller('internal')
export class InternalController {
  constructor(private readonly internalService: InternalService) {}

  @Get('bot-config')
  getBotConfig(@CurrentTenant() tenant: Tenant) {
    return this.internalService.getBotConfig(tenant);
  }
}
