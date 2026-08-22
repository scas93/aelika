import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Memoized across the whole app — loadStripe() must only be called once per
// publishable key, or it fetches Stripe.js again for nothing. Null when the
// key isn't configured, so callers can distinguish "not ready yet" from
// "never going to be ready" (see checkout-modal.tsx: TARJETA is only offered
// at all when the backend says the tenant accepts it, but the publishable
// key is a separate, frontend-only requirement to actually render the form).
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}
