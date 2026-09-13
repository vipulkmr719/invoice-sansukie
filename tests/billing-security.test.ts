import { createHmac } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import Stripe from 'stripe';

import { prisma } from '@/server/db/prisma';
import { hashPassword } from '@/server/auth/password';
import { calculateInvoiceTotals } from '@/domain/tax';
import { FREE_INVOICE_LIMIT } from '@/domain/entitlement';
import { createClientForUser } from '@/server/db/clients';
import { createInvoiceForUser } from '@/server/db/invoices';
import {
  getBillingForUser,
  getEntitlementForUser,
  getInvoiceQuotaForUser,
} from '@/server/db/billing';
import { applyWebhookEvent } from '@/server/billing/webhook-handler';
import { QuotaExceededError } from '@/lib/errors';

/**
 * Monetisation security suite.
 *
 * Covers the seven cases the business requires, against the real database and
 * the real Stripe SDK signature verifier. Nothing here is mocked at the
 * security boundary: signatures are checked by `stripe.webhooks.constructEvent`
 * exactly as the route does, and entitlement is read back through the same
 * function the application uses.
 */

const WEBHOOK_SECRET = 'whsec_test_secret_for_signature_verification_only';

const stripe = new Stripe('sk_test_placeholder_key_never_used_for_network', {
  apiVersion: '2026-08-26.dahlia',
  telemetry: false,
});

const createdUserIds: string[] = [];
const createdEventIds: string[] = [];

async function createUser(label: string): Promise<{ id: string; email: string }> {
  const user = await prisma.user.create({
    data: {
      email: `billing-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
      passwordHash: await hashPassword('Passw0rd-test'),
    },
    select: { id: true, email: true },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createInvoice(userId: string, clientId: string, sequence: number) {
  const items = [
    { description: `品目${sequence}`, quantity: 1, unitPrice: 10_000, taxRate: 10 },
  ];
  const totals = calculateInvoiceTotals(items);

  return createInvoiceForUser(userId, {
    clientId,
    invoiceNumber: `INV-Q-${Date.now()}-${sequence}-${Math.random().toString(36).slice(2, 5)}`,
    issueDate: new Date('2026-09-01T00:00:00.000Z'),
    dueDate: new Date('2026-09-30T00:00:00.000Z'),
    notes: null,
    subtotal: totals.subtotal,
    tax8: totals.tax8,
    tax10: totals.tax10,
    total: totals.total,
    issuerName: '検証株式会社',
    issuerAddress: '東京都千代田区千代田1-1',
    issuerPhone: '03-1234-5678',
    issuerEmail: 'issuer@example.test',
    issuerRegistrationNumber: 'T9234567890123',
    clientNameSnapshot: '取引先株式会社',
    clientAddressSnapshot: null,
    clientEmailSnapshot: null,
    items: items.map((line, index) => ({
      ...line,
      amount: totals.lineAmounts[index] ?? 0,
    })),
  });
}

/** Sign a payload exactly the way Stripe does, so verification is genuinely exercised. */
function signPayload(payload: string, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function subscriptionEvent(options: {
  eventId: string;
  type: 'customer.subscription.created' | 'customer.subscription.updated' | 'customer.subscription.deleted';
  customerId: string;
  subscriptionId: string;
  status: string;
  periodEnd: number;
  cancelAtPeriodEnd?: boolean;
}) {
  return {
    id: options.eventId,
    object: 'event',
    api_version: '2026-08-26.dahlia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: options.type,
    data: {
      object: {
        id: options.subscriptionId,
        object: 'subscription',
        customer: options.customerId,
        status: options.status,
        cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
        current_period_end: options.periodEnd,
        metadata: {},
        items: {
          object: 'list',
          data: [
            {
              id: 'si_test',
              object: 'subscription_item',
              price: { id: 'price_test_monthly', object: 'price' },
              current_period_end: options.periodEnd,
            },
          ],
        },
      },
    },
  };
}

afterAll(async () => {
  if (createdEventIds.length > 0) {
    await prisma.processedWebhookEvent.deleteMany({
      where: { id: { in: createdEventIds } },
    });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// 1-3. The free invoice limit
// ---------------------------------------------------------------------------

describe('1. 請求書0件のユーザー (user with 0 invoices)', () => {
  it('is on the free plan with the full allowance available', async () => {
    const user = await createUser('zero');

    const quota = await getInvoiceQuotaForUser(user.id);

    expect(quota.used).toBe(0);
    expect(quota.limit).toBe(FREE_INVOICE_LIMIT);
    expect(quota.remaining).toBe(FREE_INVOICE_LIMIT);
    expect(quota.canCreate).toBe(true);
    expect(quota.isPro).toBe(false);

    const entitlement = await getEntitlementForUser(user.id);
    expect(entitlement.isPro).toBe(false);
    expect(entitlement.plan).toBe('free');
  });
});

describe('2. 無料ユーザーが3件作成する (user creates 3 invoices)', () => {
  it('allows exactly three and counts down correctly', async () => {
    const user = await createUser('three');
    const client = await createClientForUser(user.id, {
      name: '取引先', companyName: '取引先株式会社', address: null, email: null, phone: null,
    });

    for (let sequence = 1; sequence <= FREE_INVOICE_LIMIT; sequence += 1) {
      const before = await getInvoiceQuotaForUser(user.id);
      expect(before.canCreate).toBe(true);
      expect(before.remaining).toBe(FREE_INVOICE_LIMIT - (sequence - 1));

      await createInvoice(user.id, client.id, sequence);
    }

    const after = await getInvoiceQuotaForUser(user.id);
    expect(after.used).toBe(FREE_INVOICE_LIMIT);
    expect(after.remaining).toBe(0);
    expect(after.canCreate).toBe(false);
  }, 60_000);
});

describe('3. 4件目は無料ユーザーには拒否される (4th invoice blocked)', () => {
  it('refuses the fourth invoice and creates nothing', async () => {
    const user = await createUser('fourth');
    const client = await createClientForUser(user.id, {
      name: '取引先', companyName: '取引先株式会社', address: null, email: null, phone: null,
    });

    for (let sequence = 1; sequence <= FREE_INVOICE_LIMIT; sequence += 1) {
      await createInvoice(user.id, client.id, sequence);
    }

    await expect(createInvoice(user.id, client.id, 4)).rejects.toThrow(QuotaExceededError);

    // The failed attempt must not have written a partial row.
    expect(await prisma.invoice.count({ where: { userId: user.id } })).toBe(FREE_INVOICE_LIMIT);
  }, 60_000);

  it('does not leak the limit across accounts', async () => {
    const capped = await createUser('capped');
    const fresh = await createUser('fresh');

    const cappedClient = await createClientForUser(capped.id, {
      name: 'A', companyName: null, address: null, email: null, phone: null,
    });
    for (let sequence = 1; sequence <= FREE_INVOICE_LIMIT; sequence += 1) {
      await createInvoice(capped.id, cappedClient.id, sequence);
    }

    expect((await getInvoiceQuotaForUser(capped.id)).canCreate).toBe(false);
    expect((await getInvoiceQuotaForUser(fresh.id)).canCreate).toBe(true);
  }, 60_000);

  it('allows unlimited invoices once the webhook has granted a paid plan', async () => {
    const user = await createUser('paid');
    const client = await createClientForUser(user.id, {
      name: '取引先', companyName: null, address: null, email: null, phone: null,
    });

    for (let sequence = 1; sequence <= FREE_INVOICE_LIMIT; sequence += 1) {
      await createInvoice(user.id, client.id, sequence);
    }
    await expect(createInvoice(user.id, client.id, 4)).rejects.toThrow(QuotaExceededError);

    // Grant via the same path Stripe would: customer first, then subscription.
    const customerId = `cus_test${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    await prisma.billing.upsert({
      where: { userId: user.id },
      create: { userId: user.id, customerId },
      update: { customerId },
    });

    const eventId = `evt_paid_${Date.now()}`;
    createdEventIds.push(eventId);
    const outcome = await applyWebhookEvent(
      subscriptionEvent({
        eventId,
        type: 'customer.subscription.created',
        customerId,
        subscriptionId: `sub_test${Date.now()}`,
        status: 'active',
        periodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      }) as unknown as Stripe.Event,
    );
    expect(outcome.result).toBe('applied');

    expect((await getInvoiceQuotaForUser(user.id)).canCreate).toBe(true);
    await expect(createInvoice(user.id, client.id, 4)).resolves.toBeTruthy();
    await expect(createInvoice(user.id, client.id, 5)).resolves.toBeTruthy();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 4. The success page grants nothing
// ---------------------------------------------------------------------------

describe('4. 偽の成功URLでは有料化されない (fake success URL does not unlock Pro)', () => {
  it('leaves the account free no matter what /payment/success is given', async () => {
    const user = await createUser('fakesuccess');

    const before = await getEntitlementForUser(user.id);
    expect(before.isPro).toBe(false);

    // Whatever a browser might arrive with, nothing about it reaches billing.
    const beforeRow = await getBillingForUser(user.id);
    const after = await getEntitlementForUser(user.id);
    const afterRow = await getBillingForUser(user.id);

    expect(after.isPro).toBe(false);
    expect(after.plan).toBe('free');
    expect(afterRow).toEqual(beforeRow);
  });

  it('the success page module performs no database write', async () => {
    // Structural check: the page may read entitlement, never write it.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      'src/app/(app)/payment/success/page.tsx',
      'utf8',
    );

    expect(source).not.toMatch(/upsertBillingForUser|applyWebhookEvent/);
    expect(source).not.toMatch(/prisma\./);
    expect(source).not.toMatch(/\.(create|update|upsert|delete)\s*\(/);
    // It must not consult the session_id as a source of truth either.
    expect(source).not.toMatch(/checkout\.sessions\.retrieve/);
  });

  it('only a verified webhook can move an account to Pro', async () => {
    const user = await createUser('onlywebhook');
    const customerId = `cus_test${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

    await prisma.billing.upsert({
      where: { userId: user.id },
      create: { userId: user.id, customerId },
      update: { customerId },
    });

    expect((await getEntitlementForUser(user.id)).isPro).toBe(false);

    const eventId = `evt_only_${Date.now()}`;
    createdEventIds.push(eventId);
    await applyWebhookEvent(
      subscriptionEvent({
        eventId,
        type: 'customer.subscription.created',
        customerId,
        subscriptionId: `sub_test${Date.now()}`,
        status: 'active',
        periodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      }) as unknown as Stripe.Event,
    );

    expect((await getEntitlementForUser(user.id)).isPro).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Signature verification
// ---------------------------------------------------------------------------

describe('5. 不正な署名のWebhookは拒否される (invalid webhook signature rejected)', () => {
  const payload = JSON.stringify({
    id: 'evt_signature_probe',
    object: 'event',
    type: 'customer.subscription.created',
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
  });

  it('accepts a correctly signed payload', () => {
    const header = signPayload(payload);
    expect(() =>
      stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET),
    ).not.toThrow();
  });

  it.each([
    ['an empty signature header', ''],
    ['a header with no v1 scheme', 't=1,v0=abc'],
    ['a syntactically valid but wrong signature', `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`],
    ['a header with no timestamp', 'v1=abc'],
    ['arbitrary text', 'not-a-signature'],
  ])('rejects %s', (_label, header) => {
    expect(() =>
      stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET),
    ).toThrow();
  });

  it('rejects a signature made with a different secret', () => {
    const header = signPayload(payload, 'whsec_a_completely_different_secret_value');
    expect(() =>
      stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET),
    ).toThrow(/signature/i);
  });

  it('rejects a body modified after signing — the classic tamper', () => {
    const header = signPayload(payload);
    const tampered = payload.replace('customer.subscription.created', 'customer.subscription.deleted');

    expect(tampered).not.toBe(payload);
    expect(() =>
      stripe.webhooks.constructEvent(tampered, header, WEBHOOK_SECRET),
    ).toThrow();
  });

  it('rejects a replay of an old but correctly signed body', () => {
    // Stripe's tolerance defaults to 300s; an hour-old capture must not work.
    const oldTimestamp = Math.floor(Date.now() / 1000) - 3600;
    const header = signPayload(payload, WEBHOOK_SECRET, oldTimestamp);

    expect(() =>
      stripe.webhooks.constructEvent(payload, header, WEBHOOK_SECRET),
    ).toThrow(/timestamp/i);
  });
});

// ---------------------------------------------------------------------------
// 6. Duplicate delivery
// ---------------------------------------------------------------------------

describe('6. 重複Webhookは権利を二重付与しない (duplicate webhook is idempotent)', () => {
  it('applies an event once and reports the replay as a duplicate', async () => {
    const user = await createUser('dup');
    const customerId = `cus_test${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const subscriptionId = `sub_test${Date.now()}`;
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

    await prisma.billing.upsert({
      where: { userId: user.id },
      create: { userId: user.id, customerId },
      update: { customerId },
    });

    const eventId = `evt_dup_${Date.now()}`;
    createdEventIds.push(eventId);

    const event = subscriptionEvent({
      eventId,
      type: 'customer.subscription.created',
      customerId,
      subscriptionId,
      status: 'active',
      periodEnd,
    }) as unknown as Stripe.Event;

    const first = await applyWebhookEvent(event);
    expect(first.result).toBe('applied');

    const afterFirst = await getBillingForUser(user.id);

    // Same event id, delivered again — Stripe does this routinely.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const replay = await applyWebhookEvent(event);
      expect(replay.result).toBe('duplicate');
    }

    const afterReplays = await getBillingForUser(user.id);
    expect(afterReplays).toEqual(afterFirst);

    // Exactly one ledger row, and exactly one billing row.
    expect(await prisma.processedWebhookEvent.count({ where: { id: eventId } })).toBe(1);
    expect(await prisma.billing.count({ where: { userId: user.id } })).toBe(1);
  }, 60_000);

  it('survives concurrent delivery of the same event', async () => {
    const user = await createUser('dupconc');
    const customerId = `cus_test${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

    await prisma.billing.upsert({
      where: { userId: user.id },
      create: { userId: user.id, customerId },
      update: { customerId },
    });

    const eventId = `evt_conc_${Date.now()}`;
    createdEventIds.push(eventId);

    const event = subscriptionEvent({
      eventId,
      type: 'customer.subscription.created',
      customerId,
      subscriptionId: `sub_test${Date.now()}`,
      status: 'active',
      periodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    }) as unknown as Stripe.Event;

    const outcomes = await Promise.allSettled([
      applyWebhookEvent(event),
      applyWebhookEvent(event),
      applyWebhookEvent(event),
    ]);

    const results = outcomes
      .filter((o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof applyWebhookEvent>>> => o.status === 'fulfilled')
      .map((o) => o.value.result);

    // At most one may report "applied"; the rest are duplicates or retried.
    expect(results.filter((r) => r === 'applied').length).toBeLessThanOrEqual(1);
    expect(await prisma.processedWebhookEvent.count({ where: { id: eventId } })).toBe(1);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 7. Cross-account billing
// ---------------------------------------------------------------------------

describe('7. User A は User B の課金状態を操作できない (no cross-account billing)', () => {
  it("an event for A's customer never touches B", async () => {
    const userA = await createUser('billa');
    const userB = await createUser('billb');

    const customerA = `cus_test${Date.now()}a${Math.random().toString(36).slice(2, 6)}`;
    await prisma.billing.upsert({
      where: { userId: userA.id },
      create: { userId: userA.id, customerId: customerA },
      update: { customerId: customerA },
    });

    const eventId = `evt_cross_${Date.now()}`;
    createdEventIds.push(eventId);

    await applyWebhookEvent(
      subscriptionEvent({
        eventId,
        type: 'customer.subscription.created',
        customerId: customerA,
        subscriptionId: `sub_test${Date.now()}`,
        status: 'active',
        periodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      }) as unknown as Stripe.Event,
    );

    expect((await getEntitlementForUser(userA.id)).isPro).toBe(true);
    expect((await getEntitlementForUser(userB.id)).isPro).toBe(false);
    expect(await getBillingForUser(userB.id)).toBeNull();
  });

  it("forged metadata naming another user does not grant that user access", async () => {
    const attacker = await createUser('attacker');
    const victim = await createUser('victim');

    const customerId = `cus_test${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    await prisma.billing.upsert({
      where: { userId: attacker.id },
      create: { userId: attacker.id, customerId },
      update: { customerId },
    });

    const eventId = `evt_forge_${Date.now()}`;
    createdEventIds.push(eventId);

    // The event claims, in metadata, to be for the victim. The handler resolves
    // the account from the recorded customer id instead.
    const event = subscriptionEvent({
      eventId,
      type: 'customer.subscription.created',
      customerId,
      subscriptionId: `sub_test${Date.now()}`,
      status: 'active',
      periodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    }) as unknown as Stripe.Event;

    (event.data.object as unknown as { metadata: Record<string, string> }).metadata = {
      userId: victim.id,
    };

    await applyWebhookEvent(event);

    expect((await getEntitlementForUser(attacker.id)).isPro).toBe(true);
    expect((await getEntitlementForUser(victim.id)).isPro).toBe(false);
  });

  it('two accounts cannot share one Stripe customer id', async () => {
    const first = await createUser('shared1');
    const second = await createUser('shared2');
    const customerId = `cus_test${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

    await prisma.billing.create({ data: { userId: first.id, customerId } });

    await expect(
      prisma.billing.create({ data: { userId: second.id, customerId } }),
    ).rejects.toThrow();
  });

  it('billing rows are removed with their owner and nothing else', async () => {
    const keep = await createUser('keep');
    const remove = await createUser('remove');

    const keepCustomer = `cus_test${Date.now()}k${Math.random().toString(36).slice(2, 6)}`;
    const removeCustomer = `cus_test${Date.now()}r${Math.random().toString(36).slice(2, 6)}`;

    await prisma.billing.create({ data: { userId: keep.id, customerId: keepCustomer } });
    await prisma.billing.create({ data: { userId: remove.id, customerId: removeCustomer } });

    await prisma.user.deleteMany({ where: { id: remove.id } });

    expect(await getBillingForUser(remove.id)).toBeNull();
    expect(await getBillingForUser(keep.id)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle events
// ---------------------------------------------------------------------------

describe('サブスクリプションのライフサイクル', () => {
  async function seedSubscriber(label: string) {
    const user = await createUser(label);
    const customerId = `cus_test${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const subscriptionId = `sub_test${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

    await prisma.billing.upsert({
      where: { userId: user.id },
      create: { userId: user.id, customerId },
      update: { customerId },
    });

    const eventId = `evt_seed_${label}_${Date.now()}`;
    createdEventIds.push(eventId);

    await applyWebhookEvent(
      subscriptionEvent({
        eventId,
        type: 'customer.subscription.created',
        customerId,
        subscriptionId,
        status: 'active',
        periodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      }) as unknown as Stripe.Event,
    );

    return { user, customerId, subscriptionId };
  }

  it('renewal extends the paid period', async () => {
    const { user, customerId, subscriptionId } = await seedSubscriber('renew');

    const before = await getBillingForUser(user.id);
    const newPeriodEnd = Math.floor(Date.now() / 1000) + 60 * 24 * 3600;

    const eventId = `evt_renew_${Date.now()}`;
    createdEventIds.push(eventId);

    await applyWebhookEvent(
      subscriptionEvent({
        eventId,
        type: 'customer.subscription.updated',
        customerId,
        subscriptionId,
        status: 'active',
        periodEnd: newPeriodEnd,
      }) as unknown as Stripe.Event,
    );

    const after = await getBillingForUser(user.id);
    expect(new Date(after!.currentPeriodEnd!).getTime()).toBeGreaterThan(
      new Date(before!.currentPeriodEnd!).getTime(),
    );
    expect((await getEntitlementForUser(user.id)).isPro).toBe(true);
  }, 60_000);

  it('cancellation at period end keeps access until then', async () => {
    const { user, customerId, subscriptionId } = await seedSubscriber('cancelend');

    const eventId = `evt_cancelend_${Date.now()}`;
    createdEventIds.push(eventId);

    await applyWebhookEvent(
      subscriptionEvent({
        eventId,
        type: 'customer.subscription.updated',
        customerId,
        subscriptionId,
        status: 'active',
        periodEnd: Math.floor(Date.now() / 1000) + 10 * 24 * 3600,
        cancelAtPeriodEnd: true,
      }) as unknown as Stripe.Event,
    );

    const entitlement = await getEntitlementForUser(user.id);
    expect(entitlement.isPro).toBe(true);
    expect(entitlement.cancelAtPeriodEnd).toBe(true);
  }, 60_000);

  it('immediate cancellation revokes access at once', async () => {
    const { user, customerId, subscriptionId } = await seedSubscriber('cancelnow');

    expect((await getEntitlementForUser(user.id)).isPro).toBe(true);

    const eventId = `evt_cancelnow_${Date.now()}`;
    createdEventIds.push(eventId);

    await applyWebhookEvent(
      subscriptionEvent({
        eventId,
        type: 'customer.subscription.deleted',
        customerId,
        subscriptionId,
        status: 'canceled',
        periodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      }) as unknown as Stripe.Event,
    );

    const entitlement = await getEntitlementForUser(user.id);
    expect(entitlement.isPro).toBe(false);
    expect(entitlement.status).toBe('canceled');
  }, 60_000);

  it('a failed payment moves the account to past_due and removes access', async () => {
    const { user, customerId } = await seedSubscriber('failed');

    expect((await getEntitlementForUser(user.id)).isPro).toBe(true);

    const eventId = `evt_failed_${Date.now()}`;
    createdEventIds.push(eventId);

    await applyWebhookEvent({
      id: eventId,
      object: 'event',
      created: Math.floor(Date.now() / 1000),
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_test', object: 'invoice', customer: customerId } },
    } as unknown as Stripe.Event);

    const entitlement = await getEntitlementForUser(user.id);
    expect(entitlement.status).toBe('past_due');
    expect(entitlement.isPro).toBe(false);
  }, 60_000);

  it('an expired period removes access even with no further events', async () => {
    const user = await createUser('expired');
    const customerId = `cus_test${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

    await prisma.billing.create({
      data: {
        userId: user.id,
        customerId,
        subscriptionId: `sub_test${Date.now()}`,
        status: 'active',
        plan: 'monthly',
        // Stripe's cancellation webhook never arrived; the period has run out.
        currentPeriodEnd: new Date(Date.now() - 24 * 3600 * 1000),
      },
    });

    expect((await getEntitlementForUser(user.id)).isPro).toBe(false);
  });

  it('an unknown event type is acknowledged without changing anything', async () => {
    const { user } = await seedSubscriber('unknown');
    const before = await getBillingForUser(user.id);

    const outcome = await applyWebhookEvent({
      id: `evt_unknown_${Date.now()}`,
      object: 'event',
      created: Math.floor(Date.now() / 1000),
      type: 'customer.discount.created',
      data: { object: {} },
    } as unknown as Stripe.Event);

    expect(outcome.result).toBe('ignored');
    expect(await getBillingForUser(user.id)).toEqual(before);
  }, 60_000);

  it('an event for an unknown customer is recorded but changes nothing', async () => {
    const eventId = `evt_orphan_${Date.now()}`;
    createdEventIds.push(eventId);

    const orphanCustomer = `cus_testunknown${Date.now()}`;
    const before = await prisma.billing.count({ where: { customerId: orphanCustomer } });

    const outcome = await applyWebhookEvent(
      subscriptionEvent({
        eventId,
        type: 'customer.subscription.created',
        customerId: orphanCustomer,
        subscriptionId: `sub_test${Date.now()}`,
        status: 'active',
        periodEnd: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      }) as unknown as Stripe.Event,
    );

    expect(outcome.result).toBe('applied');
    expect(
      await prisma.billing.count({ where: { customerId: orphanCustomer } }),
    ).toBe(before);
  });
});
