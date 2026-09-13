import 'server-only';

import type Stripe from 'stripe';

import { env } from '@/lib/env';
import { getStripeCustomerId, setStripeCustomerId } from '@/server/db/billing';

import { requireStripe } from './stripe';

/**
 * Stripe Checkout session creation.
 *
 * Card details are entered on Stripe's own hosted page, never on ours — which
 * is why no card number, CVV or expiry ever touches this application or its
 * database. We hand Stripe a price and an account reference and get back a URL.
 *
 * Both billing shapes the business wants are supported here: `monthly` creates
 * a subscription, `lifetime` a one-time payment. Adding a second tier later is
 * another price id, not another code path.
 */

export type PurchaseKind = 'monthly' | 'lifetime';

export class UnknownPriceError extends Error {
  constructor(kind: PurchaseKind) {
    super(`${kind} プランは現在ご利用いただけません。`);
    this.name = 'UnknownPriceError';
  }
}

function priceIdFor(kind: PurchaseKind): string {
  const priceId =
    kind === 'monthly' ? env.STRIPE_PRICE_ID_MONTHLY : env.STRIPE_PRICE_ID_LIFETIME;

  if (!priceId) throw new UnknownPriceError(kind);
  return priceId;
}

/**
 * Reuse this account's Stripe customer, creating one on first purchase.
 *
 * Recording the customer id up front is what lets the webhook map later events
 * back to the right account without trusting anything in the payload.
 */
async function ensureCustomerId(
  stripe: Stripe,
  userId: string,
  email: string,
): Promise<string> {
  const existing = await getStripeCustomerId(userId);
  if (existing) return existing;

  const customer = await stripe.customers.create({
    email,
    // Our own id, so a customer in the Stripe dashboard is traceable back to
    // an account. Read back only as a hint — never as authorisation.
    metadata: { userId },
  });

  await setStripeCustomerId(userId, customer.id);

  return customer.id;
}

export interface CheckoutSessionResult {
  url: string;
  sessionId: string;
}

export async function createCheckoutSession(options: {
  userId: string;
  email: string;
  kind: PurchaseKind;
}): Promise<CheckoutSessionResult> {
  const stripe = requireStripe();
  const priceId = priceIdFor(options.kind);

  const customerId = await ensureCustomerId(stripe, options.userId, options.email);

  const session = await stripe.checkout.sessions.create({
    mode: options.kind === 'monthly' ? 'subscription' : 'payment',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],

    // Set by this server, so the webhook can trust it as an account reference.
    client_reference_id: options.userId,

    // The success page is informational only — it confirms nothing and grants
    // nothing. Entitlement arrives via the webhook.
    success_url: `${env.APP_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_URL}/payment/cancelled`,

    allow_promotion_codes: true,
    ...(options.kind === 'monthly'
      ? { subscription_data: { metadata: { userId: options.userId } } }
      : { payment_intent_data: { metadata: { userId: options.userId } } }),
  });

  if (!session.url) {
    throw new Error('Stripe returned a session without a URL');
  }

  return { url: session.url, sessionId: session.id };
}
