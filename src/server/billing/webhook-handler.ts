import 'server-only';

import type Stripe from 'stripe';

import {
  normalizeStripeStatus,
  type BillingStatusName,
} from '@/domain/entitlement';
import {
  persistWebhookEvent,
  type BillingPatch,
  type WebhookDbContext,
} from '@/server/db/billing';

/**
 * Stripe webhook processing — the only code in the application that grants or
 * revokes paid access.
 *
 * This module owns the *mapping* from a Stripe event to a billing change. The
 * transaction that records the event id and writes the row lives in the
 * repository layer (`persistWebhookEvent`), which is also the only place with a
 * Prisma client. Two invariants come out of that split:
 *
 *  1. **Idempotency.** Stripe delivers at-least-once; the same event will
 *     arrive again. The event id is inserted in the same transaction as the
 *     billing write, so a replay rolls back without touching billing.
 *
 *  2. **No trust in the payload's idea of identity.** The account is resolved
 *     from the Stripe customer id recorded at checkout, or from the
 *     `client_reference_id` that *this server* set when creating the session —
 *     never from a user id a caller placed in event metadata.
 */

/** Events this application acts on. Anything else is acknowledged and ignored. */
export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
] as const;

export type WebhookOutcome =
  | { result: 'applied'; detail: string }
  | { result: 'duplicate'; detail: string }
  | { result: 'ignored'; detail: string };

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Stripe gives ids either inline or expanded; accept both. */
function idOf(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object') {
    return asString((value as { id?: unknown }).id);
  }
  return null;
}

function periodEndOf(subscription: Stripe.Subscription): Date | null {
  // Newer API versions carry the period on each item rather than the
  // subscription, so read both.
  const record = subscription as unknown as Record<string, unknown>;

  const direct = record.current_period_end;
  if (typeof direct === 'number') return new Date(direct * 1000);

  const firstItem = subscription.items?.data?.[0] as
    | (Stripe.SubscriptionItem & { current_period_end?: number })
    | undefined;

  if (typeof firstItem?.current_period_end === 'number') {
    return new Date(firstItem.current_period_end * 1000);
  }

  return null;
}

function priceIdOf(subscription: Stripe.Subscription): string | null {
  return idOf(subscription.items?.data?.[0]?.price);
}

/**
 * Resolve which local account an event belongs to.
 *
 * Preference order: the customer id we already recorded, then the
 * `client_reference_id` this server attached when it created the Checkout
 * session. Metadata is read only as that same server-set reference.
 */
async function resolveUserId(
  db: WebhookDbContext,
  options: { customerId?: string | null; clientReferenceId?: string | null },
): Promise<string | null> {
  if (options.customerId) {
    const existing = await db.findUserIdByCustomerId(options.customerId);
    if (existing) return existing;
  }

  if (options.clientReferenceId && (await db.userExists(options.clientReferenceId))) {
    return options.clientReferenceId;
  }

  return null;
}

/**
 * Apply one verified Stripe event.
 *
 * The caller must already have verified the signature — this function assumes
 * the event is genuine and concerns itself only with applying it exactly once.
 */
export async function applyWebhookEvent(event: Stripe.Event): Promise<WebhookOutcome> {
  if (!(HANDLED_EVENT_TYPES as readonly string[]).includes(event.type)) {
    // Acknowledge with 200 so Stripe stops retrying an event we do not act on.
    return { result: 'ignored', detail: `unhandled event type ${event.type}` };
  }

  return persistWebhookEvent(
    { id: event.id, type: event.type, createdAt: new Date(event.created * 1000) },
    (db) => buildPatch(db, event),
  );
}

async function buildPatch(
  db: WebhookDbContext,
  event: Stripe.Event,
): Promise<BillingPatch> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;

      const customerId = idOf(session.customer);
      const userId = await resolveUserId(db, {
        customerId,
        clientReferenceId: session.client_reference_id,
      });

      if (!userId) return null;

      // A subscription checkout is finalised by the subscription events that
      // follow; this one records the customer so those can find the account.
      // The plan stays `free` until then — `resolveEntitlement` grants nothing
      // for a free plan, so this intermediate state is safe.
      if (session.mode === 'subscription') {
        return {
          userId,
          data: { customerId, subscriptionId: idOf(session.subscription) },
        };
      }

      // One-time purchase: entitlement is granted here and never expires.
      if (session.mode === 'payment') {
        if (session.payment_status !== 'paid') return null;

        return {
          userId,
          data: {
            customerId,
            plan: 'lifetime',
            status: 'active',
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
          },
        };
      }

      return { userId, data: { customerId } };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;

      const customerId = idOf(subscription.customer);
      const userId = await resolveUserId(db, {
        customerId,
        clientReferenceId: asString(subscription.metadata?.userId),
      });

      if (!userId) return null;

      // A deleted subscription is over regardless of the status Stripe sends.
      const deleted = event.type === 'customer.subscription.deleted';
      const status: BillingStatusName = deleted
        ? 'canceled'
        : normalizeStripeStatus(subscription.status);

      // A lifetime purchase is not undone by subscription churn.
      if ((await db.getPlanForUser(userId)) === 'lifetime') {
        return { userId, data: { customerId, subscriptionId: subscription.id } };
      }

      return {
        userId,
        data: {
          customerId,
          subscriptionId: subscription.id,
          status,
          plan: 'monthly',
          // Epoch for a deletion: the period is unambiguously in the past, so
          // entitlement fails closed even if a later event is missed.
          currentPeriodEnd: deleted ? new Date(0) : periodEndOf(subscription),
          cancelAtPeriodEnd: deleted ? false : subscription.cancel_at_period_end === true,
          priceId: priceIdOf(subscription),
        },
      };
    }

    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;

      const customerId = idOf(invoice.customer);
      const userId = await resolveUserId(db, { customerId });
      if (!userId) return null;

      // Lifetime access is unaffected by subscription invoices.
      if ((await db.getPlanForUser(userId)) === 'lifetime') return null;

      // A failure moves the account out of entitlement immediately. A success
      // only restates it: the authoritative period comes from the subscription
      // object, which arrives in the customer.subscription.updated event Stripe
      // sends alongside. Never grant access here without a period to back it.
      if (event.type === 'invoice.payment_failed') {
        return { userId, data: { customerId, status: 'past_due' } };
      }

      if (!(await db.getSubscriptionIdForUser(userId))) return null;

      return { userId, data: { customerId } };
    }

    default:
      return null;
  }
}
