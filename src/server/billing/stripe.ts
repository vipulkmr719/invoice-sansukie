import 'server-only';

import Stripe from 'stripe';

import { env, isBillingConfigured } from '@/lib/env';

/**
 * The Stripe SDK client.
 *
 * Created lazily so the module can be imported — by tests, or by a deployment
 * that has not configured payments — without a secret key. Anything that
 * actually calls Stripe goes through `requireStripe()` and fails with a clear
 * message rather than a null dereference.
 */

let client: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;

  client ??= new Stripe(env.STRIPE_SECRET_KEY, {
    // Pinning the API version keeps Stripe's own upgrades from silently
    // changing the shape of the objects this code reads.
    apiVersion: '2026-08-26.dahlia',
    typescript: true,
    telemetry: false,
    maxNetworkRetries: 2,
  });

  return client;
}

export class BillingNotConfiguredError extends Error {
  constructor() {
    super('決済機能が構成されていません。');
    this.name = 'BillingNotConfiguredError';
  }
}

export function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe || !isBillingConfigured()) {
    throw new BillingNotConfiguredError();
  }
  return stripe;
}

export { isBillingConfigured };
