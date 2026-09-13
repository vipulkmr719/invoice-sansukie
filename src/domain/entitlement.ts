/**
 * 課金プランと利用上限 (plans and entitlements).
 *
 * Pure logic, no I/O: given a billing record and a point in time, decide what
 * the account may do. Keeping the decision in one pure function means the rule
 * can be exhaustively tested, and that nothing else in the codebase is tempted
 * to reimplement "is this user paid?" slightly differently.
 */

/** How many invoices a free account may create in total. */
export const FREE_INVOICE_LIMIT = 3;

export const BILLING_PLANS = ['free', 'monthly', 'lifetime'] as const;
export type BillingPlanName = (typeof BILLING_PLANS)[number];

/**
 * Every status the billing row may hold: Stripe's subscription statuses plus
 * `none` for an account that has never purchased. Declared here so the domain
 * owns the vocabulary and the database enum mirrors it, rather than the other
 * way round.
 */
export const BILLING_STATUSES = [
  'none',
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const;
export type BillingStatusName = (typeof BILLING_STATUSES)[number];

export function isBillingStatus(value: string): value is BillingStatusName {
  return (BILLING_STATUSES as readonly string[]).includes(value);
}

/**
 * Map a status Stripe sent onto one we store. An unrecognised status is
 * treated as `unpaid` rather than passed through: a new Stripe status must
 * never accidentally satisfy the entitlement check.
 */
export function normalizeStripeStatus(value: string | null | undefined): BillingStatusName {
  if (!value) return 'none';
  return isBillingStatus(value) ? value : 'unpaid';
}

/**
 * Stripe subscription statuses that represent a paid, usable subscription.
 *
 * `past_due` is deliberately excluded: Stripe keeps a subscription in that
 * state while it retries a failed payment, and the account has not paid for the
 * period. `trialing` is included — a trial is access the business chose to
 * grant.
 */
const ENTITLING_STATUSES = new Set(['active', 'trialing']);

export interface BillingSnapshot {
  status: BillingStatusName;
  plan: BillingPlanName;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface Entitlement {
  /** True only when the account may create invoices without limit. */
  isPro: boolean;
  plan: BillingPlanName;
  status: BillingStatusName;
  /** null for a free account or a lifetime purchase. */
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** null when unlimited. */
  invoiceLimit: number | null;
}

/**
 * Decide entitlement from the billing row alone.
 *
 * Nothing here reads a URL, a query parameter, a cookie or a client-supplied
 * flag. The only inputs are the row the Stripe webhook wrote and the clock.
 */
export function resolveEntitlement(
  billing: BillingSnapshot | null,
  now: Date = new Date(),
): Entitlement {
  if (!billing) {
    return {
      isPro: false,
      plan: 'free',
      status: 'none',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      invoiceLimit: FREE_INVOICE_LIMIT,
    };
  }

  const base = {
    plan: billing.plan,
    status: billing.status,
    currentPeriodEnd: billing.currentPeriodEnd,
    cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
  };

  // A one-time purchase never expires and has no subscription status.
  if (billing.plan === 'lifetime') {
    return { ...base, isPro: true, invoiceLimit: null };
  }

  const statusEntitles = ENTITLING_STATUSES.has(billing.status);

  // A paid period that has run out is not access, whatever the stored status
  // says. This is what makes a missed `customer.subscription.deleted` webhook
  // fail closed rather than open.
  const periodIsCurrent =
    billing.currentPeriodEnd !== null &&
    billing.currentPeriodEnd.getTime() > now.getTime();

  const isPro = statusEntitles && periodIsCurrent;

  return { ...base, isPro, invoiceLimit: isPro ? null : FREE_INVOICE_LIMIT };
}

export interface InvoiceQuota {
  used: number;
  limit: number | null;
  remaining: number | null;
  canCreate: boolean;
  isPro: boolean;
}

/** Combine an entitlement with the account's current invoice count. */
export function resolveInvoiceQuota(
  entitlement: Entitlement,
  invoiceCount: number,
): InvoiceQuota {
  if (entitlement.invoiceLimit === null) {
    return {
      used: invoiceCount,
      limit: null,
      remaining: null,
      canCreate: true,
      isPro: entitlement.isPro,
    };
  }

  const remaining = Math.max(entitlement.invoiceLimit - invoiceCount, 0);

  return {
    used: invoiceCount,
    limit: entitlement.invoiceLimit,
    remaining,
    canCreate: remaining > 0,
    isPro: entitlement.isPro,
  };
}

export const QUOTA_REACHED_MESSAGE =
  `無料プランで作成できる請求書は${FREE_INVOICE_LIMIT}件までです。` +
  'アップグレードすると無制限に作成できます。';
