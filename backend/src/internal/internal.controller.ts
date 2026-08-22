import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { InternalService } from './internal.service';
import { Public } from '../auth/decorators/public.decorator';
import { BotAuthGuard } from '../auth/guards/bot-auth.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { Tenant } from '../../generated/prisma/client';

// @Public() (class-level) skips the global JwtAuthGuard/RolesGuard for every
// route here — bot-config is server-to-server (BotAuthGuard, per-tenant
// botApiKey), and the onboarding redirect routes have no guard at all —
// Stripe sends the tenant's own browser there, not an API client, so
// there's no key to check. Stripe Connect account creation/status now live
// under TenantController (POST/GET /tenant/me/stripe-account,
// .../stripe-status) — JWT + @Roles(DUENO), like the rest of tenant
// settings — since it's a Dueño-initiated action, not a server-to-server
// call. See CLAUDE.md.
@Public()
@Controller('internal')
export class InternalController {
  constructor(private readonly internalService: InternalService) {}

  @UseGuards(BotAuthGuard)
  @Get('bot-config')
  getBotConfig(@CurrentTenant() tenant: Tenant) {
    return this.internalService.getBotConfig(tenant);
  }

  @Get('stripe/onboarding-complete')
  @Header('Content-Type', 'text/html; charset=utf-8')
  onboardingComplete() {
    return '<!doctype html><p>Registro completado, puedes cerrar esta ventana.</p>';
  }

  @Get('stripe/onboarding-refresh')
  @Header('Content-Type', 'text/html; charset=utf-8')
  onboardingRefresh() {
    return '<!doctype html><p>El link expiró, pide uno nuevo.</p>';
  }
}
