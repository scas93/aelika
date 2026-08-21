import { Controller, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { InternalService } from './internal.service';
import { Public } from '../auth/decorators/public.decorator';
import { BotAuthGuard } from '../auth/guards/bot-auth.guard';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { Tenant } from '../../generated/prisma/client';

// @Public() (class-level) skips the global JwtAuthGuard/RolesGuard for every
// route here — none of them have a user/rol, all server-to-server or a
// tenant's own browser redirect. Guards are applied per-method instead of at
// the class level because different routes need different ones: BotAuthGuard
// (per-tenant botApiKey) for bot-config, InternalApiKeyGuard (single global
// secret) for the Stripe account endpoints, and no guard at all for the
// onboarding redirect routes — Stripe sends the tenant's own browser there,
// not an API client, so there's no key to check.
@Public()
@Controller('internal')
export class InternalController {
  constructor(private readonly internalService: InternalService) {}

  @UseGuards(BotAuthGuard)
  @Get('bot-config')
  getBotConfig(@CurrentTenant() tenant: Tenant) {
    return this.internalService.getBotConfig(tenant);
  }

  @UseGuards(InternalApiKeyGuard)
  @Post('tenants/:slug/stripe-account')
  createStripeAccount(@Param('slug') slug: string) {
    return this.internalService.createStripeAccount(slug);
  }

  @UseGuards(InternalApiKeyGuard)
  @Get('tenants/:slug/stripe-status')
  getStripeStatus(@Param('slug') slug: string) {
    return this.internalService.getStripeStatus(slug);
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
