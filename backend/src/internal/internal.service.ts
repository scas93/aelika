import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../generated/prisma/enums';
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
   * Creates a Stripe Connect account for this tenant via the v2 Core
   * Accounts API (v1 account creation is rejected outright on this Stripe
   * account — "Accounts v1 no longer recommended for new Connect
   * integrations" — confirmed against the real API, not just SDK docs; see
   * CLAUDE.md), stores its id, and returns a hosted onboarding link. 409 if
   * the tenant already has one — this never replaces an existing
   * stripeAccountId.
   */
  async createStripeAccount(slug: string) {
    const tenant = await this.resolverTenant(slug);
    if (tenant.stripeAccountId) {
      throw new ConflictException('Este negocio ya tiene una cuenta de Stripe conectada');
    }

    // configuration.recipient requires a contact email on the account —
    // confirmed by testing (400 naming exactly this requirement). Tenant has
    // no email of its own, so this uses the tenant's Dueño — the only
    // Tenant-scoped user role guaranteed to exist (AuthService/UsersService
    // never let a tenant end up without an active Dueño).
    const dueno = await this.prisma.user.findFirst({ where: { tenantId: tenant.id, rol: Role.DUENO } });
    if (!dueno) {
      throw new NotFoundException('Este negocio no tiene un Dueño activo para usar como contacto de Stripe');
    }

    // Two separate configurations, each with its own capability namespace:
    // `merchant` (card_payments — charging the customer) and `recipient`
    // (stripe_balance.stripe_transfers — receiving that money into the
    // account's own Stripe balance, a prerequisite for payouts). Confirmed
    // against the actual v2 Accounts API types — stripe_balance is NOT under
    // merchant.capabilities, it's exclusively under recipient.capabilities.
    // "payouts" itself (balance -> the tenant's bank) isn't a requestable
    // capability in either configuration — it activates on its own once
    // identity/bank requirements are satisfied — see getStripeStatus.
    const account = await this.stripeService.client.v2.core.accounts.create({
      dashboard: 'express',
      contact_email: dueno.email,
      identity: { country: 'mx' },
      // v2's equivalent of v1's controller.fees.payer/controller.losses.payments
      // ("application" = the platform pays Stripe's fees / absorbs losses, not
      // the connected account) — required by the API as soon as a merchant or
      // a recipient with stripe_transfers is configured (confirmed by testing:
      // omitting this returns a 400 naming exactly these two fields).
      defaults: {
        responsibilities: {
          fees_collector: 'application_express',
          losses_collector: 'application',
        },
      },
      configuration: {
        merchant: {
          capabilities: {
            card_payments: { requested: true },
          },
        },
        recipient: {
          capabilities: {
            stripe_balance: { stripe_transfers: { requested: true } },
          },
        },
      },
    });

    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { stripeAccountId: account.id },
    });

    const apiBaseUrl = this.configService.get<string>('API_BASE_URL') ?? API_BASE_URL_DEFAULT;
    const accountLink = await this.stripeService.client.v2.core.accountLinks.create({
      account: account.id,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['merchant', 'recipient'],
          return_url: `${apiBaseUrl}/internal/stripe/onboarding-complete`,
          refresh_url: `${apiBaseUrl}/internal/stripe/onboarding-refresh`,
        },
      },
    });

    return { url: accountLink.url };
  }

  /**
   * Live status straight from Stripe (never trusts only what's stored),
   * refreshing Tenant.stripeChargesEnabled/stripePayoutsEnabled with
   * whatever it finds. card_payments.status (merchant) and
   * stripe_balance.payouts.status (recipient) are v2's per-capability status
   * ('active'|'pending'|'restricted'|'unsupported') — mapped to the same two
   * booleans v1's charges_enabled/payouts_enabled gave us, so the rest of
   * the app (Tenant schema, webhook handler) doesn't need to know which API
   * version created the account.
   */
  async getStripeStatus(slug: string) {
    const tenant = await this.resolverTenant(slug);
    if (!tenant.stripeAccountId) {
      return { estado: 'sin_cuenta' as const };
    }

    const account = await this.stripeService.client.v2.core.accounts.retrieve(tenant.stripeAccountId, {
      include: ['configuration.merchant', 'configuration.recipient'],
    });

    const chargesEnabled = account.configuration?.merchant?.capabilities?.card_payments?.status === 'active';
    const payoutsEnabled = account.configuration?.recipient?.capabilities?.stripe_balance?.payouts?.status === 'active';

    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        stripeChargesEnabled: chargesEnabled,
        stripePayoutsEnabled: payoutsEnabled,
      },
    });

    return {
      estado: 'con_cuenta' as const,
      stripeAccountId: tenant.stripeAccountId,
      chargesEnabled,
      payoutsEnabled,
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
