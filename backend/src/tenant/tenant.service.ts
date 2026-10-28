import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { normalizarHorarioSemana } from '../common/horario';
import { generateApiKey } from '../common/api-key';
import { normalizarNumeroAtencion } from '../common/telefono';
import { resolverMensajeBienvenida } from '../common/mensaje-bienvenida';
import {
  normalizarVentanaRecepcion,
  ventanaDesdeTenant,
} from '../common/ventana-recepcion-b2b';
import {
  MODALIDADES_COBRO,
  normalizarModalidades,
  validarModalidadesActivas,
} from '../common/modalidades-cobro';
import { ClienteCanal, Role } from '../../generated/prisma/enums';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateNegocioDto } from './dto/update-negocio.dto';
import type {
  DiaSemana,
  FacturacionModo,
  GiroNegocio,
} from '../../generated/prisma/enums';

const SETTINGS_SELECT = {
  nombre: true,
  giroNegocio: true,
  mensajeBienvenida: true,
  horarioAtencion: true,
  ubicacion: true,
  botApiKey: true,
  botWebhookUrl: true,
  botWebhookSecret: true,
  candadoMarketingDias: true,
  facturacionModo: true,
  stripeContactEmail: true,
  // Read-only here — never accepted by UpdateTenantDto. stripeAccountId is
  // set by createOrContinueStripeAccount; charges/payoutsEnabled are only
  // ever refreshed from Stripe itself (getStripeStatus, the webhook), never
  // written by a settings save.
  stripeAccountId: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  modalidadesCobroB2b: true,
  pedidoB2bMinimoPiezas: true,
  pedidoB2bVentanaAperturaDia: true,
  pedidoB2bVentanaAperturaHora: true,
  pedidoB2bVentanaCierreDia: true,
  pedidoB2bVentanaCierreHora: true,
  portalHoraEntrega: true,
  portalHorasAgregarDia: true,
  portalHorasModificar: true,
  portalHorizonteSemanas: true,
  numeroAtencion: true,
} as const;

// Subconjunto que ve y edita el Gerente (Ajustes → Información del negocio): nada de llaves, Stripe, facturación, mayoreo ni giro.
const NEGOCIO_SELECT = {
  mensajeBienvenida: true,
  horarioAtencion: true,
  ubicacion: true,
} as const;

const API_BASE_URL_DEFAULT = 'http://localhost:3001';

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
  ) {}

  async getMine(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: SETTINGS_SELECT,
    });
    return this.present(tenant);
  }

  // El giro es exclusivo del Admin: para cualquier otro rol ni se lee de la base ni se escribe, y la clave no sale en la respuesta.
  async getNegocio(tenantId: string, rol: Role) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { ...NEGOCIO_SELECT, giroNegocio: rol === Role.DUENO },
    });
    return this.presentNegocio(tenant, rol);
  }

  async updateNegocio(tenantId: string, rol: Role, dto: UpdateNegocioDto) {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        // Mismo criterio que updateMine: un textarea vacío vuelve a null para que se aplique el mensaje por defecto.
        mensajeBienvenida:
          dto.mensajeBienvenida !== undefined
            ? dto.mensajeBienvenida.trim() || null
            : undefined,
        horarioAtencion: dto.horarioAtencion
          ? (normalizarHorarioSemana(dto.horarioAtencion) as any)
          : undefined,
        ubicacion: dto.ubicacion,
        giroNegocio: rol === Role.DUENO ? dto.giroNegocio : undefined,
      },
      select: { ...NEGOCIO_SELECT, giroNegocio: rol === Role.DUENO },
    });
    return this.presentNegocio(tenant, rol);
  }

  private presentNegocio(
    tenant: {
      giroNegocio?: GiroNegocio | null;
      mensajeBienvenida: string | null;
      horarioAtencion: unknown;
      ubicacion: string | null;
    },
    rol: Role,
  ) {
    return {
      ...(rol === Role.DUENO
        ? { giroNegocio: tenant.giroNegocio ?? null }
        : {}),
      mensajeBienvenida: resolverMensajeBienvenida(tenant.mensajeBienvenida),
      horarioAtencion: tenant.horarioAtencion,
      ubicacion: tenant.ubicacion,
    };
  }

  async updateMine(tenantId: string, dto: UpdateTenantDto) {
    // botApiKey (like slug/nombre) is intentionally absent from UpdateTenantDto,
    // so there's nothing to strip here — the global ValidationPipe's whitelist
    // already drops it if a client sends it. Regeneration is a separate,
    // deliberate action (see regenerateBotKey), not a side effect of a
    // routine settings save.
    const ventana = normalizarVentanaRecepcion(dto.ventanaRecepcionB2b);
    const modalidadesCobroB2b =
      dto.modalidadesCobroB2b !== undefined
        ? await this.resolverModalidadesActivas(
            tenantId,
            dto.modalidadesCobroB2b,
          )
        : undefined;
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        // Normalize a cleared textarea back to null instead of storing "",
        // so getMine() re-applies the default next time instead of showing blank.
        mensajeBienvenida:
          dto.mensajeBienvenida !== undefined
            ? dto.mensajeBienvenida.trim() || null
            : undefined,
        horarioAtencion: dto.horarioAtencion
          ? (normalizarHorarioSemana(dto.horarioAtencion) as any)
          : undefined,
        ubicacion: dto.ubicacion,
        giroNegocio: dto.giroNegocio,
        facturacionModo: dto.facturacionModo,
        stripeContactEmail: dto.stripeContactEmail,
        modalidadesCobroB2b,
        pedidoB2bMinimoPiezas: dto.pedidoB2bMinimoPiezas,
        pedidoB2bVentanaAperturaDia: ventana?.pedidoB2bVentanaAperturaDia,
        pedidoB2bVentanaAperturaHora: ventana?.pedidoB2bVentanaAperturaHora,
        pedidoB2bVentanaCierreDia: ventana?.pedidoB2bVentanaCierreDia,
        pedidoB2bVentanaCierreHora: ventana?.pedidoB2bVentanaCierreHora,
        botWebhookUrl: dto.botWebhookUrl,
        botWebhookSecret: dto.botWebhookSecret,
        candadoMarketingDias: dto.candadoMarketingDias,
        portalHoraEntrega: dto.portalHoraEntrega,
        portalHorasAgregarDia: dto.portalHorasAgregarDia,
        portalHorasModificar: dto.portalHorasModificar,
        portalHorizonteSemanas: dto.portalHorizonteSemanas,
        numeroAtencion:
          dto.numeroAtencion !== undefined
            ? normalizarNumeroAtencion(dto.numeroAtencion)
            : undefined,
      },
      select: SETTINGS_SELECT,
    });
    return this.present(tenant);
  }

  /**
   * Valida las modalidades que se quieren dejar activas: al menos una (cualquier vía), conocidas y solo en negocios de
   * mayoreo. El DTO ya lo exige; esto cubre cualquier otro llamador del servicio.
   */
  private async resolverModalidadesActivas(tenantId: string, raw: unknown) {
    const activas = validarModalidadesActivas(raw);
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { tipoStorefront: true },
    });
    if (t.tipoStorefront !== 'RETAIL_B2B') {
      throw new BadRequestException(
        'Las modalidades de cobro solo aplican a negocios de mayoreo',
      );
    }
    return activas;
  }

  /**
   * Cuántos clientes B2B activos (sin baja) usan cada modalidad. Informativo: la interfaz lo muestra antes de confirmar que
   * se desactiva una modalidad en uso. No se exige exactitud al guardar.
   */
  async usoModalidadesCobro(tenantId: string) {
    const filas = await this.prisma.cliente.groupBy({
      by: ['modalidadPago'],
      where: { tenantId, canal: ClienteCanal.B2B, bajaAt: null },
      _count: { _all: true },
    });
    const uso: Record<string, number> = {};
    for (const m of MODALIDADES_COBRO) uso[m] = 0;
    for (const f of filas) {
      if (f.modalidadPago) uso[f.modalidadPago] = f._count._all;
    }
    return uso;
  }

  async regenerateBotKey(tenantId: string) {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { botApiKey: generateApiKey() },
      select: SETTINGS_SELECT,
    });
    return this.present(tenant);
  }

  /**
   * POST /tenant/me/stripe-account. Same account-creation logic that used to
   * live in InternalService.createStripeAccount (moved here now that it's a
   * Dueño-initiated action, not a server-to-server call — see CLAUDE.md),
   * plus the "onboarding got left half-done" case that endpoint didn't
   * handle: if the tenant already has a stripeAccountId but isn't fully
   * enabled yet, this generates a fresh account link for that *same* account
   * instead of erroring — no separate "resume onboarding" endpoint needed.
   */
  async createOrContinueStripeAccount(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
    });

    if (
      tenant.stripeAccountId &&
      tenant.stripeChargesEnabled &&
      tenant.stripePayoutsEnabled
    ) {
      throw new ConflictException(
        'Este negocio ya está completamente conectado con Stripe',
      );
    }

    let accountId = tenant.stripeAccountId;

    if (!accountId) {
      // configuration.recipient requires a contact email on the account —
      // confirmed by testing (400 naming exactly this requirement). No
      // default/backfill exists on purpose, so this 400 is what forces
      // stripeContactEmail to be filled in (via PATCH /tenant/me) before
      // onboarding can start.
      if (!tenant.stripeContactEmail) {
        throw new BadRequestException(
          'Configura primero el correo de contacto para Stripe, requerido para crear la cuenta',
        );
      }

      // Two separate configurations, each with its own capability namespace:
      // `merchant` (card_payments — charging the customer) and `recipient`
      // (stripe_balance.stripe_transfers — receiving that money into the
      // account's own Stripe balance, a prerequisite for payouts). See
      // CLAUDE.md for why stripe_balance lives under recipient, not merchant.
      const account = await this.stripeService.client.v2.core.accounts.create({
        dashboard: 'express',
        contact_email: tenant.stripeContactEmail,
        identity: { country: 'mx' },
        // v2's equivalent of v1's controller.fees.payer/controller.losses.payments
        // ("application" = the platform pays Stripe's fees / absorbs losses,
        // not the connected account).
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
      accountId = account.id;
    }

    const apiBaseUrl =
      this.configService.get<string>('API_BASE_URL') ?? API_BASE_URL_DEFAULT;
    const accountLink =
      await this.stripeService.client.v2.core.accountLinks.create({
        account: accountId,
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
   * GET /tenant/me/stripe-status. Same logic that used to live in
   * InternalService.getStripeStatus, adapted to tenantId instead of slug —
   * live status straight from Stripe (never trusted as stale), refreshing
   * Tenant.stripeChargesEnabled/stripePayoutsEnabled with whatever it finds.
   */
  async getStripeStatus(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { id: true, stripeAccountId: true },
    });
    if (!tenant.stripeAccountId) {
      return { estado: 'sin_cuenta' as const };
    }

    const account = await this.stripeService.client.v2.core.accounts.retrieve(
      tenant.stripeAccountId,
      {
        include: ['configuration.merchant', 'configuration.recipient'],
      },
    );

    const chargesEnabled =
      account.configuration?.merchant?.capabilities?.card_payments?.status ===
      'active';
    const payoutsEnabled =
      account.configuration?.recipient?.capabilities?.stripe_balance?.payouts
        ?.status === 'active';

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

  private present(tenant: {
    nombre: string;
    giroNegocio: GiroNegocio | null;
    mensajeBienvenida: string | null;
    horarioAtencion: unknown;
    ubicacion: string | null;
    botApiKey: string;
    botWebhookUrl: string | null;
    botWebhookSecret: string | null;
    candadoMarketingDias: number | null;
    facturacionModo: FacturacionModo;
    stripeContactEmail: string | null;
    stripeAccountId: string | null;
    stripeChargesEnabled: boolean;
    stripePayoutsEnabled: boolean;
    modalidadesCobroB2b: unknown;
    pedidoB2bMinimoPiezas: number;
    pedidoB2bVentanaAperturaDia: DiaSemana | null;
    pedidoB2bVentanaAperturaHora: string | null;
    pedidoB2bVentanaCierreDia: DiaSemana | null;
    pedidoB2bVentanaCierreHora: string | null;
    portalHoraEntrega: string;
    portalHorasAgregarDia: number;
    portalHorasModificar: number;
    portalHorizonteSemanas: number;
    numeroAtencion: string | null;
  }) {
    return {
      nombre: tenant.nombre,
      giroNegocio: tenant.giroNegocio,
      mensajeBienvenida: resolverMensajeBienvenida(tenant.mensajeBienvenida),
      horarioAtencion: tenant.horarioAtencion,
      ubicacion: tenant.ubicacion,
      stripeContactEmail: tenant.stripeContactEmail,
      botApiKey: tenant.botApiKey,
      botWebhookUrl: tenant.botWebhookUrl,
      botWebhookSecret: tenant.botWebhookSecret,
      candadoMarketingDias: tenant.candadoMarketingDias,
      facturacionModo: tenant.facturacionModo,
      stripeAccountId: tenant.stripeAccountId,
      stripeChargesEnabled: tenant.stripeChargesEnabled,
      stripePayoutsEnabled: tenant.stripePayoutsEnabled,
      modalidadesCobroB2b: normalizarModalidades(tenant.modalidadesCobroB2b),
      pedidoB2bMinimoPiezas: tenant.pedidoB2bMinimoPiezas,
      ventanaRecepcionB2b: ventanaDesdeTenant(tenant),
      portalHoraEntrega: tenant.portalHoraEntrega,
      portalHorasAgregarDia: tenant.portalHorasAgregarDia,
      portalHorasModificar: tenant.portalHorasModificar,
      portalHorizonteSemanas: tenant.portalHorizonteSemanas,
      numeroAtencion: tenant.numeroAtencion,
    };
  }
}
