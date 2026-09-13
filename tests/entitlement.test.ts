import { describe, expect, it } from 'vitest';

import {
  FREE_INVOICE_LIMIT,
  normalizeStripeStatus,
  resolveEntitlement,
  resolveInvoiceQuota,
  type BillingSnapshot,
} from '@/domain/entitlement';

/**
 * The entitlement rule, in isolation.
 *
 * This is the function that decides whether an account has paid, so it is
 * tested exhaustively over every Stripe status and every period boundary. The
 * bias throughout is fail-closed: anything ambiguous must resolve to "free".
 */

const NOW = new Date('2026-09-13T00:00:00.000Z');
const FUTURE = new Date('2026-10-13T00:00:00.000Z');
const PAST = new Date('2026-08-13T00:00:00.000Z');

function snapshot(overrides: Partial<BillingSnapshot> = {}): BillingSnapshot {
  return {
    status: 'active',
    plan: 'monthly',
    currentPeriodEnd: FUTURE,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe('無料プラン (no billing record)', () => {
  it('treats an account with no billing row as free', () => {
    const entitlement = resolveEntitlement(null, NOW);

    expect(entitlement.isPro).toBe(false);
    expect(entitlement.plan).toBe('free');
    expect(entitlement.status).toBe('none');
    expect(entitlement.invoiceLimit).toBe(FREE_INVOICE_LIMIT);
  });

  it('caps the free plan at 3 invoices', () => {
    expect(FREE_INVOICE_LIMIT).toBe(3);
  });
});

describe('月額プラン (subscription)', () => {
  it('grants access for an active subscription within its period', () => {
    const entitlement = resolveEntitlement(snapshot(), NOW);

    expect(entitlement.isPro).toBe(true);
    expect(entitlement.invoiceLimit).toBeNull();
  });

  it('grants access during a trial', () => {
    expect(resolveEntitlement(snapshot({ status: 'trialing' }), NOW).isPro).toBe(true);
  });

  it.each([
    'none',
    'incomplete',
    'incomplete_expired',
    'past_due',
    'canceled',
    'unpaid',
    'paused',
  ] as const)('refuses access for status %s even within the period', (status) => {
    const entitlement = resolveEntitlement(snapshot({ status }), NOW);

    expect(entitlement.isPro).toBe(false);
    expect(entitlement.invoiceLimit).toBe(FREE_INVOICE_LIMIT);
  });

  it('refuses access once the paid period has passed, whatever the status says', () => {
    // This is what makes a missed cancellation webhook fail closed.
    const entitlement = resolveEntitlement(
      snapshot({ status: 'active', currentPeriodEnd: PAST }),
      NOW,
    );

    expect(entitlement.isPro).toBe(false);
  });

  it('refuses access when the period end is missing', () => {
    expect(
      resolveEntitlement(snapshot({ currentPeriodEnd: null }), NOW).isPro,
    ).toBe(false);
  });

  it('refuses access exactly at the period end', () => {
    expect(resolveEntitlement(snapshot({ currentPeriodEnd: NOW }), NOW).isPro).toBe(false);
  });

  it('keeps access until the end of a period the user has cancelled', () => {
    const entitlement = resolveEntitlement(
      snapshot({ cancelAtPeriodEnd: true }),
      NOW,
    );

    expect(entitlement.isPro).toBe(true);
    expect(entitlement.cancelAtPeriodEnd).toBe(true);
  });

  it('…and drops access once that period is over', () => {
    expect(
      resolveEntitlement(
        snapshot({ cancelAtPeriodEnd: true, currentPeriodEnd: PAST }),
        NOW,
      ).isPro,
    ).toBe(false);
  });
});

describe('買い切りプラン (one-time purchase)', () => {
  it('grants access with no period at all', () => {
    const entitlement = resolveEntitlement(
      snapshot({ plan: 'lifetime', status: 'active', currentPeriodEnd: null }),
      NOW,
    );

    expect(entitlement.isPro).toBe(true);
    expect(entitlement.invoiceLimit).toBeNull();
  });

  it('never expires', () => {
    expect(
      resolveEntitlement(
        snapshot({ plan: 'lifetime', currentPeriodEnd: PAST }),
        new Date('2099-01-01T00:00:00.000Z'),
      ).isPro,
    ).toBe(true);
  });
});

describe('normalizeStripeStatus', () => {
  it('passes through statuses we know', () => {
    expect(normalizeStripeStatus('active')).toBe('active');
    expect(normalizeStripeStatus('past_due')).toBe('past_due');
  });

  it('maps an unknown status to unpaid rather than trusting it', () => {
    // A status Stripe adds in future must never accidentally entitle.
    expect(normalizeStripeStatus('some_new_status')).toBe('unpaid');
    expect(normalizeStripeStatus('ACTIVE')).toBe('unpaid');
    expect(normalizeStripeStatus('active ')).toBe('unpaid');
  });

  it('maps absent to none', () => {
    expect(normalizeStripeStatus(null)).toBe('none');
    expect(normalizeStripeStatus(undefined)).toBe('none');
    expect(normalizeStripeStatus('')).toBe('none');
  });
});

describe('resolveInvoiceQuota', () => {
  const free = resolveEntitlement(null, NOW);
  const pro = resolveEntitlement(snapshot(), NOW);

  it.each([
    [0, 3, true],
    [1, 2, true],
    [2, 1, true],
    [3, 0, false],
    [4, 0, false],
    [99, 0, false],
  ])('free account with %i invoices has %i remaining (canCreate=%s)', (used, remaining, canCreate) => {
    const quota = resolveInvoiceQuota(free, used);

    expect(quota.used).toBe(used);
    expect(quota.limit).toBe(3);
    expect(quota.remaining).toBe(remaining);
    expect(quota.canCreate).toBe(canCreate);
  });

  it('gives a paid account no limit at any count', () => {
    for (const used of [0, 3, 1000]) {
      const quota = resolveInvoiceQuota(pro, used);
      expect(quota.limit).toBeNull();
      expect(quota.remaining).toBeNull();
      expect(quota.canCreate).toBe(true);
    }
  });
});
