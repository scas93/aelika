import { BadRequestException, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

// Capability-status events for both configurations we request on account
// creation (see InternalService.createStripeAccount) — card_payments lives
// under `merchant`, stripe_balance (transfers/payouts) lives under
// `recipient`. Any other event type is ignored.
const RELEVANT_EVENT_TYPES = new Set([
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

  /**
   * Needs the raw (unparsed) request body to verify Stripe's signature — see
   * `rawBody: true` in main.ts, which preserves it as `req.rawBody` without
   * disabling the global JSON body-parser for every other route.
   *
   * Uses `parseEventNotification`, not `webhooks.constructEvent` — our
   * connected accounts are v2 (see CLAUDE.md: v1 account creation is
   * rejected outright on this Stripe account), and `constructEvent` throws
   * on a v2 payload by design ("You passed a thin event notification to a
   * function that expects a webhook"). Same signature header/verification
   * mechanism either way — `parseEventNotification` just skips that check.
   */
  @Post('stripe')
  @HttpCode(200)
  async handleStripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    if (!signature || !req.rawBody) {
      throw new BadRequestException('Falta la firma del webhook');
    }

    const webhookSecret = this.configService.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');

    let notification;
    try {
      notification = await this.stripeService.client.parseEventNotificationAsync(req.rawBody, signature, webhookSecret);
    } catch {
      throw new BadRequestException('Firma de webhook inválida');
    }

    if (RELEVANT_EVENT_TYPES.has(notification.type)) {
      // v2 notifications are "thin" — related_object only carries id/type/url,
      // never the updated fields themselves. Re-fetching with `include` (same
      // fields InternalService.getStripeStatus reads) is what actually gets
      // us the new capability statuses, not related_object or fetchEvent().
      const accountId = notification.related_object?.id;
      if (accountId) {
        const account = await this.stripeService.client.v2.core.accounts.retrieve(accountId, {
          include: ['configuration.merchant', 'configuration.recipient'],
        });
        const chargesEnabled = account.configuration?.merchant?.capabilities?.card_payments?.status === 'active';
        const payoutsEnabled =
          account.configuration?.recipient?.capabilities?.stripe_balance?.payouts?.status === 'active';

        // updateMany (not update): matches 0 rows and does nothing — no
        // throw — when this account.id isn't any tenant's, e.g. an unrelated
        // Stripe account. Same "ignore, respond 200" outcome either way.
        await this.prisma.tenant.updateMany({
          where: { stripeAccountId: accountId },
          data: { stripeChargesEnabled: chargesEnabled, stripePayoutsEnabled: payoutsEnabled },
        });
      }
    }

    // Every other event type is ignored — Stripe only needs a 200 to stop
    // retrying, regardless of whether we acted on it.
    return { received: true };
  }
}
