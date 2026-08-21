import { BadRequestException, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from '../stripe/stripe.service';

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
   */
  @Post('stripe')
  @HttpCode(200)
  async handleStripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    if (!signature || !req.rawBody) {
      throw new BadRequestException('Falta la firma del webhook');
    }

    const webhookSecret = this.configService.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');

    let event: Stripe.Event;
    try {
      event = this.stripeService.client.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
    } catch {
      throw new BadRequestException('Firma de webhook inválida');
    }

    if (event.type === 'account.updated') {
      const account = event.data.object as Stripe.Account;
      // updateMany (not update): matches 0 rows and does nothing — no
      // throw — when this account.id isn't any tenant's, e.g. an unrelated
      // Stripe account. Same "ignore, respond 200" outcome either way.
      await this.prisma.tenant.updateMany({
        where: { stripeAccountId: account.id },
        data: {
          stripeChargesEnabled: account.charges_enabled,
          stripePayoutsEnabled: account.payouts_enabled,
        },
      });
    }

    // Every other event type is ignored — Stripe only needs a 200 to stop
    // retrying, regardless of whether we acted on it.
    return { received: true };
  }
}
