import { BadRequestException, Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';
import { EstadoPago } from '../../generated/prisma/client';

// Capability-status events for both configurations we request on account
// creation (see TenantService.createOrContinueStripeAccount) — card_payments
// lives under `merchant`, stripe_balance (transfers/payouts) lives under
// `recipient`. Any other thin event type is ignored.
const RELEVANT_THIN_EVENT_TYPES = new Set([
  'v2.core.account[configuration.merchant].capability_status_updated',
  'v2.core.account[configuration.recipient].capability_status_updated',
]);

// @Public() — Stripe calls this directly, no JWT/session. Authenticity comes
// entirely from the stripe-signature header verified below against
// STRIPE_WEBHOOK_SECRET, not from any Nest guard.
@Public()
@Controller('webhooks')
export class StripeWebhookController {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {}

  private readonly logger = new Logger(StripeWebhookController.name);

  /**
   * Needs the raw (unparsed) request body to verify Stripe's signature — see
   * `rawBody: true` in main.ts, which preserves it as `req.rawBody` without
   * disabling the global JSON body-parser for every other route.
   *
   * This single endpoint receives two different event shapes on the same
   * Stripe account: v2 "thin" events (Connect account capability updates —
   * our connected accounts are v2, see CLAUDE.md) and classic v1 events
   * (PaymentIntent — still a v1-style resource with full-snapshot events).
   * `webhooks.constructEventAsync` throws on a v2 thin payload by design
   * ("You passed a thin event notification to a function that expects a
   * webhook"), and `parseEventNotificationAsync` is the mirror image for v1
   * payloads — so classic is tried first and thin is the fallback. Each is a
   * separate Event Destination in Stripe with its own signing secret
   * (STRIPE_WEBHOOK_SECRET for classic, STRIPE_WEBHOOK_SECRET_V2 for thin) —
   * they are never interchangeable outside of a shared `stripe listen`
   * session in local dev.
   */
  @Post('stripe')
  @HttpCode(200)
  async handleStripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    if (!signature || !req.rawBody) {
      throw new BadRequestException('Falta la firma del webhook');
    }

    const webhookSecret = this.configService.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
    const webhookSecretV2 = this.configService.getOrThrow<string>('STRIPE_WEBHOOK_SECRET_V2');

    try {
      const event = await this.stripeService.client.webhooks.constructEventAsync(req.rawBody, signature, webhookSecret);
      await this.handleClassicEvent(event);
      return { received: true };
    } catch (error) {
      // Expected for a v2 thin payload (wrong shape for this verifier) as
      // much as for an actually-wrong secret — logged so the two are
      // distinguishable if the thin attempt below also ends up failing.
      this.logger.debug(`Classic (v1) webhook verification failed, trying thin (v2): ${(error as Error).message}`);
    }

    try {
      const notification = await this.stripeService.client.parseEventNotificationAsync(
        req.rawBody,
        signature,
        webhookSecretV2,
      );
      await this.handleThinEvent(notification);
      return { received: true };
    } catch (error) {
      this.logger.warn(`Thin (v2) webhook verification also failed: ${(error as Error).message}`);
      throw new BadRequestException('Firma de webhook inválida');
    }
  }

  /** PaymentIntent events (metodoPago = TARJETA) — see PublicService.createOrder. */
  private async handleClassicEvent(event: Stripe.Event) {
    if (event.type !== 'payment_intent.succeeded' && event.type !== 'payment_intent.payment_failed') {
      return;
    }

    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const estadoPago = event.type === 'payment_intent.succeeded' ? EstadoPago.PAGADO : EstadoPago.FALLIDO;

    // updateMany (not update): matches 0 rows and does nothing when this
    // PaymentIntent isn't tied to any order (e.g. a stray/unrelated one on
    // the platform account) — same "ignore, respond 200" outcome as below.
    await this.prisma.order.updateMany({
      where: { stripePaymentIntentId: paymentIntent.id },
      data: { estadoPago },
    });
  }

  /** v2 thin events — Connect account capability updates. */
  private async handleThinEvent(notification: Stripe.V2.Core.EventNotification) {
    if (!RELEVANT_THIN_EVENT_TYPES.has(notification.type)) {
      return;
    }

    // v2 notifications are "thin" — related_object only carries id/type/url,
    // never the updated fields themselves. Re-fetching with `include` (same
    // fields TenantService.getStripeStatus reads) is what actually gets
    // us the new capability statuses, not related_object or fetchEvent().
    // Cast needed: EventNotification is a union over every v2 event kind,
    // most of which (e.g. billing meter events) carry no related_object at
    // all — RELEVANT_THIN_EVENT_TYPES already narrowed to the two kinds that do.
    const accountId = (notification as unknown as { related_object?: { id?: string } }).related_object?.id;
    if (!accountId) {
      return;
    }

    const account = await this.stripeService.client.v2.core.accounts.retrieve(accountId, {
      include: ['configuration.merchant', 'configuration.recipient'],
    });
    const chargesEnabled = account.configuration?.merchant?.capabilities?.card_payments?.status === 'active';
    const payoutsEnabled = account.configuration?.recipient?.capabilities?.stripe_balance?.payouts?.status === 'active';

    // updateMany (not update): matches 0 rows and does nothing — no
    // throw — when this account.id isn't any tenant's, e.g. an unrelated
    // Stripe account. Same "ignore, respond 200" outcome either way.
    await this.prisma.tenant.updateMany({
      where: { stripeAccountId: accountId },
      data: { stripeChargesEnabled: chargesEnabled, stripePayoutsEnabled: payoutsEnabled },
    });
  }
}
