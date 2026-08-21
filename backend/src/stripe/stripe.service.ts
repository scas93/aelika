import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Thin wrapper around a single Stripe client for the platform (Aelika)
 * account. No apiVersion pinned explicitly — the installed SDK's own bundled
 * default is used, so it always matches whatever this stripe-node version
 * was built against instead of a hardcoded string that could drift.
 */
@Injectable()
export class StripeService {
  readonly client: Stripe;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.getOrThrow<string>('STRIPE_SECRET_KEY');
    this.client = new Stripe(secretKey);
  }
}
