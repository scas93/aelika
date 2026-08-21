import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Tenant } from '../../generated/prisma/client';
import { isAbiertoAhora, HorarioSemana } from '../common/horario';
import { resolverMensajeBienvenida } from '../common/mensaje-bienvenida';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

const STOREFRONT_BASE_URL_DEFAULT = 'http://localhost:3000/tienda';
const API_BASE_URL_DEFAULT = 'http://localhost:3001';

@Injectable()
export class InternalService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {}

  getBotConfig(tenant: Tenant) {
    const storefrontBaseUrl = this.configService.get<string>('STOREFRONT_BASE_URL') ?? STOREFRONT_BASE_URL_DEFAULT;

    return {
      nombre: tenant.nombre,
      mensajeBienvenida: resolverMensajeBienvenida(tenant.mensajeBienvenida),
      abierto: isAbiertoAhora(tenant.horarioAtencion as HorarioSemana | null),
      ubicacion: tenant.ubicacion,
      catalogoUrl: `${storefrontBaseUrl}/${tenant.slug}`,
    };
  }

  /**
   * Creates a Stripe Connect account for this tenant (Express-dashboard
   * equivalent via `controller`, not the deprecated `type: 'express'`
   * shorthand — see CLAUDE.md), stores its id, and returns a hosted
   * onboarding link. 409 if the tenant already has one — this never replaces
   * an existing stripeAccountId.
   */
  async createStripeAccount(slug: string) {
    const tenant = await this.resolverTenant(slug);
    if (tenant.stripeAccountId) {
      throw new ConflictException('Este negocio ya tiene una cuenta de Stripe conectada');
    }

    const account = await this.stripeService.client.accounts.create({
      country: 'mx',
      controller: {
        stripe_dashboard: { type: 'express' },
        fees: { payer: 'application' },
        losses: { payments: 'application' },
        requirement_collection: 'stripe',
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { stripeAccountId: account.id },
    });

    const apiBaseUrl = this.configService.get<string>('API_BASE_URL') ?? API_BASE_URL_DEFAULT;
    const accountLink = await this.stripeService.client.accountLinks.create({
      account: account.id,
      type: 'account_onboarding',
      return_url: `${apiBaseUrl}/internal/stripe/onboarding-complete`,
      refresh_url: `${apiBaseUrl}/internal/stripe/onboarding-refresh`,
    });

    return { url: accountLink.url };
  }

  /**
   * Live status straight from Stripe (never trusts only what's stored),
   * refreshing Tenant.stripeChargesEnabled/stripePayoutsEnabled with
   * whatever it finds — same fields the account.updated webhook keeps in
   * sync going forward.
   */
  async getStripeStatus(slug: string) {
    const tenant = await this.resolverTenant(slug);
    if (!tenant.stripeAccountId) {
      return { estado: 'sin_cuenta' as const };
    }

    const account = await this.stripeService.client.accounts.retrieve(tenant.stripeAccountId);

    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        stripeChargesEnabled: account.charges_enabled,
        stripePayoutsEnabled: account.payouts_enabled,
      },
    });

    return {
      estado: 'con_cuenta' as const,
      stripeAccountId: tenant.stripeAccountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
    };
  }

  /**
   * Same pattern as PublicService: plain PrismaService (not
   * TenantPrismaService, which depends on a JWT session that doesn't exist
   * on these server-to-server endpoints), 404 if the slug doesn't resolve.
   */
  private async resolverTenant(slug: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      throw new NotFoundException('Negocio no encontrado');
    }
    return tenant;
  }
}
