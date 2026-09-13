import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '@/server/db/prisma';
import { hashPassword } from '@/server/auth/password';
import { calculateInvoiceTotals } from '@/domain/tax';
import { createClientForUser, getClientForUser } from '@/server/db/clients';
import { createInvoiceForUser } from '@/server/db/invoices';
import { upsertCompanyForUser, getCompanyForUser } from '@/server/db/companies';

/**
 * Database invariants, asserted against the live schema.
 *
 * These are the structural guarantees the application's security rests on:
 * a missing foreign key or a loosened cascade would not fail any feature test,
 * but would quietly remove a layer of isolation. Reading them back out of
 * `pg_constraint` catches that.
 */

interface ConstraintRow {
  table_name: string;
  constraint_name: string;
  definition: string;
}

async function foreignKeys(): Promise<ConstraintRow[]> {
  return prisma.$queryRaw<ConstraintRow[]>`
    SELECT conrelid::regclass::text AS table_name,
           conname                  AS constraint_name,
           pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    ORDER BY 1, 2
  `;
}

async function checkConstraints(): Promise<ConstraintRow[]> {
  return prisma.$queryRaw<ConstraintRow[]>`
    SELECT conrelid::regclass::text AS table_name,
           conname                  AS constraint_name,
           pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE contype = 'c' AND connamespace = 'public'::regnamespace
    ORDER BY 1, 2
  `;
}

async function indexNames(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
  `;
  return rows.map((row) => row.indexname);
}

const createdUserIds: string[] = [];

async function createUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `dbinv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
      passwordHash: await hashPassword('Passw0rd-test'),
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function seedInvoice(userId: string, clientId: string, suffix: string) {
  const items = [
    { description: 'item', quantity: 1, unitPrice: 10_000, taxRate: 10 },
  ];
  const totals = calculateInvoiceTotals(items);

  return createInvoiceForUser(userId, {
    clientId,
    invoiceNumber: `INV-DB-${Date.now()}-${suffix}`,
    issueDate: new Date('2026-09-01T00:00:00.000Z'),
    dueDate: new Date('2026-09-30T00:00:00.000Z'),
    notes: null,
    subtotal: totals.subtotal,
    tax8: totals.tax8,
    tax10: totals.tax10,
    total: totals.total,
    issuerName: 'Issuer KK',
    issuerAddress: 'Tokyo',
    issuerPhone: '03-1234-5678',
    issuerEmail: 'issuer@example.test',
    issuerRegistrationNumber: 'T9234567890123',
    clientNameSnapshot: 'Client KK',
    clientAddressSnapshot: null,
    clientEmailSnapshot: null,
    items: items.map((line, index) => ({
      ...line,
      amount: totals.lineAmounts[index] ?? 0,
    })),
  });
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Foreign keys
// ---------------------------------------------------------------------------

describe('foreign keys', () => {
  it.each(['billing', 'clients', 'companies', 'invoices'])(
    '%s.userId references users and cascades on delete',
    async (table) => {
      // `invoices` carries two foreign keys mentioning userId — the one to
      // users and the composite one to clients. Select the users key.
      const fk = (await foreignKeys()).find(
        (row) =>
          row.table_name === table &&
          row.definition.includes('"userId"') &&
          row.definition.includes('REFERENCES users(id)'),
      );

      expect(fk, `${table} has no userId foreign key to users`).toBeDefined();
      expect(fk?.definition).toContain('ON DELETE CASCADE');
    },
  );

  it('invoices references clients by (clientId, userId), not by id alone', async () => {
    const fks = await foreignKeys();
    const clientFk = fks.find(
      (row) => row.table_name === 'invoices' && row.definition.includes('REFERENCES clients'),
    );

    expect(clientFk).toBeDefined();
    // The tenant-scoped key: an invoice cannot point at another user's client.
    expect(clientFk?.definition).toContain('("clientId", "userId")');
    expect(clientFk?.definition).toContain('clients(id, "userId")');

    // And no single-column clientId foreign key remains alongside it.
    const single = fks.filter(
      (row) =>
        row.table_name === 'invoices' &&
        row.definition.includes('REFERENCES clients') &&
        !row.definition.includes('"userId"'),
    );
    expect(single).toEqual([]);
  });

  it('the clients composite key is unique, or the foreign key could not exist', async () => {
    expect(await indexNames()).toContain('clients_id_userId_key');
  });

  it('invoice items cascade from their invoice', async () => {
    const fk = (await foreignKeys()).find(
      (row) => row.table_name === 'invoice_items',
    );

    expect(fk?.definition).toContain('REFERENCES invoices(id)');
    expect(fk?.definition).toContain('ON DELETE CASCADE');
  });

  it('every tenant-owned table has a userId foreign key', async () => {
    const fks = await foreignKeys();

    for (const table of ['billing', 'clients', 'companies', 'invoices']) {
      const hasUserFk = fks.some(
        (row) => row.table_name === table && row.definition.includes('REFERENCES users(id)'),
      );
      expect(hasUserFk, `${table} is not tied to a user`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Ownership and uniqueness
// ---------------------------------------------------------------------------

describe('ownership constraints', () => {
  it.each([
    'companies_userId_key', // one company per user
    'billing_userId_key', // one billing row per user
    'billing_customerId_key', // a Stripe customer belongs to one account
    'billing_subscriptionId_key',
    'invoices_userId_invoiceNumber_key', // numbers unique within an account
    'clients_id_userId_key',
    'users_email_key',
  ])('the unique constraint %s exists', async (name) => {
    expect(await indexNames()).toContain(name);
  });

  it('two accounts may use the same invoice number independently', async () => {
    const first = await createUser();
    const second = await createUser();

    const firstClient = await createClientForUser(first, {
      name: 'A', companyName: null, address: null, email: null, phone: null,
    });
    const secondClient = await createClientForUser(second, {
      name: 'B', companyName: null, address: null, email: null, phone: null,
    });

    const shared = `INV-SHARED-${Date.now()}`;
    const items = [{ description: 'x', quantity: 1, unitPrice: 1000, taxRate: 10 }];
    const totals = calculateInvoiceTotals(items);
    const payload = {
      invoiceNumber: shared,
      issueDate: new Date('2026-09-01T00:00:00.000Z'),
      dueDate: new Date('2026-09-30T00:00:00.000Z'),
      notes: null,
      subtotal: totals.subtotal,
      tax8: totals.tax8,
      tax10: totals.tax10,
      total: totals.total,
      issuerName: 'I', issuerAddress: 'A', issuerPhone: '03-1111-2222',
      issuerEmail: 'i@example.test', issuerRegistrationNumber: 'T9234567890123',
      clientNameSnapshot: 'C', clientAddressSnapshot: null, clientEmailSnapshot: null,
      items: items.map((line, i) => ({ ...line, amount: totals.lineAmounts[i] ?? 0 })),
    };

    await expect(
      createInvoiceForUser(first, { ...payload, clientId: firstClient.id }),
    ).resolves.toBeTruthy();
    await expect(
      createInvoiceForUser(second, { ...payload, clientId: secondClient.id }),
    ).resolves.toBeTruthy();
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

describe('indexes', () => {
  it.each([
    ['clients_userId_idx', 'listing a tenant clients'],
    ['clients_userId_createdAt_idx', 'ordering that list'],
    ['invoices_userId_issueDate_idx', 'the invoice list and monthly chart'],
    ['invoices_userId_dueDate_idx', 'the overdue count'],
    ['invoices_clientId_userId_idx', 'the composite foreign key and per-client lookups'],
    ['invoice_items_invoiceId_idx', 'loading an invoice detail'],
    ['billing_status_idx', 'finding subscriptions by state'],
    ['billing_currentPeriodEnd_idx', 'finding expiring subscriptions'],
    ['rate_limits_expiresAt_idx', 'pruning expired windows'],
    ['processed_webhook_events_processedAt_idx', 'webhook auditing'],
  ])('%s exists (%s)', async (name) => {
    expect(await indexNames()).toContain(name);
  });

  it('every tenant query path leads with userId', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('clients', 'invoices')
        AND indexname LIKE '%userId%'
    `;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // Either userId leads, or it is the tenant half of the composite key.
      const leadsWithUserId = /\(\s*"userId"/.test(row.indexdef);
      // Postgres prints unquoted lower-case identifiers, so `id` has no
      // quotes while `"userId"` does.
      const isTenantComposite = /"?clientId"?,\s*"userId"|\bid,\s*"userId"/.test(
        row.indexdef,
      );
      expect(
        leadsWithUserId || isTenantComposite,
        `${row.indexname}: ${row.indexdef}`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Check constraints
// ---------------------------------------------------------------------------

describe('check constraints', () => {
  it.each([
    'invoice_items_tax_rate_allowed',
    'invoice_items_quantity_non_negative',
    'invoice_items_unit_price_non_negative',
    'invoice_items_amount_non_negative',
    'invoices_amounts_non_negative',
    'invoices_total_is_consistent',
    'invoices_due_after_issue',
    'invoices_issuer_registration_number_format',
    'companies_registration_number_format',
    'billing_customer_id_format',
    'billing_subscription_id_format',
    'billing_price_id_format',
    'billing_monthly_requires_subscription',
    'rate_limits_count_non_negative',
  ])('%s is present', async (name) => {
    const names = (await checkConstraints()).map((row) => row.constraint_name);
    expect(names).toContain(name);
  });
});

// ---------------------------------------------------------------------------
// Deletion behaviour
// ---------------------------------------------------------------------------

describe('deletion behaviour', () => {
  it('deleting a user removes every row they own, and nothing else', async () => {
    const victim = await createUser();
    const bystander = await createUser();

    for (const userId of [victim, bystander]) {
      await upsertCompanyForUser(userId, {
        name: 'Corp', address: 'Tokyo', phone: '03-1234-5678',
        email: 'a@example.test', registrationNumber: 'T9234567890123',
      });
      const client = await createClientForUser(userId, {
        name: 'Client', companyName: null, address: null, email: null, phone: null,
      });
      await seedInvoice(userId, client.id, userId.slice(-4));
      await prisma.billing.upsert({
        where: { userId },
        create: { userId, customerId: `cus_test${Math.random().toString(36).slice(2, 12)}` },
        update: {},
      });
    }

    const victimInvoices = await prisma.invoice.count({ where: { userId: victim } });
    expect(victimInvoices).toBe(1);

    // One statement cascading through company, clients, invoices, items and
    // billing. This is the case the NO ACTION foreign key makes reliable:
    // RESTRICT would succeed or fail depending on cascade ordering.
    await prisma.user.deleteMany({ where: { id: victim } });

    expect(await prisma.invoice.count({ where: { userId: victim } })).toBe(0);
    expect(await prisma.client.count({ where: { userId: victim } })).toBe(0);
    expect(await prisma.billing.count({ where: { userId: victim } })).toBe(0);
    expect(await getCompanyForUser(victim)).toBeNull();
    expect(
      await prisma.invoiceItem.count({ where: { invoice: { userId: victim } } }),
    ).toBe(0);

    // The bystander is untouched.
    expect(await prisma.invoice.count({ where: { userId: bystander } })).toBe(1);
    expect(await prisma.client.count({ where: { userId: bystander } })).toBe(1);
    expect(await getCompanyForUser(bystander)).not.toBeNull();
  }, 90_000);

  it('a client with invoices cannot be deleted', async () => {
    const userId = await createUser();
    const client = await createClientForUser(userId, {
      name: 'Client', companyName: null, address: null, email: null, phone: null,
    });
    await seedInvoice(userId, client.id, 'restrict');

    // Refused with a readable message by the repository…
    const { deleteClientForUser } = await import('@/server/db/clients');
    await expect(deleteClientForUser(userId, client.id)).rejects.toThrow();

    // …and by the database if the repository were bypassed.
    await expect(
      prisma.client.deleteMany({ where: { id: client.id, userId } }),
    ).rejects.toThrow();

    expect(await getClientForUser(userId, client.id)).not.toBeNull();
  }, 60_000);

  it('deleting an invoice removes its items', async () => {
    const userId = await createUser();
    const client = await createClientForUser(userId, {
      name: 'Client', companyName: null, address: null, email: null, phone: null,
    });
    const invoice = await seedInvoice(userId, client.id, 'items');

    expect(
      await prisma.invoiceItem.count({ where: { invoice: { userId } } }),
    ).toBeGreaterThan(0);

    await prisma.invoice.deleteMany({ where: { id: invoice.id, userId } });

    expect(await prisma.invoiceItem.count({ where: { invoice: { userId } } })).toBe(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Transaction boundaries
// ---------------------------------------------------------------------------

describe('transaction boundaries', () => {
  it('a rejected invoice leaves no partial row behind', async () => {
    const userId = await createUser();
    const client = await createClientForUser(userId, {
      name: 'Client', companyName: null, address: null, email: null, phone: null,
    });

    const before = await prisma.invoice.count({ where: { userId } });

    // A duplicate number fails after the ownership check but before insert.
    const invoice = await seedInvoice(userId, client.id, 'tx');
    await expect(
      createInvoiceForUser(userId, {
        clientId: client.id,
        invoiceNumber: invoice.invoiceNumber,
        issueDate: new Date('2026-09-01T00:00:00.000Z'),
        dueDate: new Date('2026-09-30T00:00:00.000Z'),
        notes: null,
        subtotal: 1000, tax8: 0, tax10: 100, total: 1100,
        issuerName: 'I', issuerAddress: 'A', issuerPhone: '03-1111-2222',
        issuerEmail: 'i@example.test', issuerRegistrationNumber: 'T9234567890123',
        clientNameSnapshot: 'C', clientAddressSnapshot: null, clientEmailSnapshot: null,
        items: [{ description: 'x', quantity: 1, unitPrice: 1000, taxRate: 10, amount: 1000 }],
      }),
    ).rejects.toThrow();

    // Exactly the one that succeeded.
    expect(await prisma.invoice.count({ where: { userId } })).toBe(before + 1);
    expect(await prisma.invoiceItem.count({ where: { invoice: { userId } } })).toBe(1);
  }, 60_000);

  it('an invoice and its items are written atomically', async () => {
    const userId = await createUser();
    const client = await createClientForUser(userId, {
      name: 'Client', companyName: null, address: null, email: null, phone: null,
    });

    // A line item violating the tax-rate check must abort the whole insert.
    await expect(
      createInvoiceForUser(userId, {
        clientId: client.id,
        invoiceNumber: `INV-ATOMIC-${Date.now()}`,
        issueDate: new Date('2026-09-01T00:00:00.000Z'),
        dueDate: new Date('2026-09-30T00:00:00.000Z'),
        notes: null,
        subtotal: 1000, tax8: 0, tax10: 50, total: 1050,
        issuerName: 'I', issuerAddress: 'A', issuerPhone: '03-1111-2222',
        issuerEmail: 'i@example.test', issuerRegistrationNumber: 'T9234567890123',
        clientNameSnapshot: 'C', clientAddressSnapshot: null, clientEmailSnapshot: null,
        items: [{ description: 'bad rate', quantity: 1, unitPrice: 1000, taxRate: 5, amount: 1000 }],
      }),
    ).rejects.toThrow();

    // No orphan invoice header survived the failed item insert.
    expect(await prisma.invoice.count({ where: { userId } })).toBe(0);
  }, 60_000);

  it('a webhook event and its billing change commit together', async () => {
    const userId = await createUser();
    const customerId = `cus_test${Math.random().toString(36).slice(2, 12)}`;

    await prisma.billing.create({ data: { userId, customerId } });

    const { applyWebhookEvent } = await import('@/server/billing/webhook-handler');
    const eventId = `evt_txn_${Date.now()}`;

    const event = {
      id: eventId,
      object: 'event',
      created: Math.floor(Date.now() / 1000),
      type: 'customer.subscription.created',
      data: {
        object: {
          id: `sub_test${Date.now()}`,
          object: 'subscription',
          customer: customerId,
          status: 'active',
          cancel_at_period_end: false,
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          metadata: {},
          items: { data: [{ id: 'si_1', price: { id: 'price_x' }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await applyWebhookEvent(event);

    // Both halves are present, or neither would be.
    expect(await prisma.processedWebhookEvent.count({ where: { id: eventId } })).toBe(1);
    const billing = await prisma.billing.findUnique({
      where: { userId },
      select: { status: true },
    });
    expect(billing?.status).toBe('active');

    await prisma.processedWebhookEvent.deleteMany({ where: { id: eventId } });
  }, 60_000);

  it('invoice creation holds a per-user lock, so a concurrent burst cannot exceed the free limit', async () => {
    const userId = await createUser();
    const client = await createClientForUser(userId, {
      name: 'Client', companyName: null, address: null, email: null, phone: null,
    });

    // Six simultaneous attempts on a free account capped at three.
    const attempts = Array.from({ length: 6 }, (_, index) =>
      seedInvoice(userId, client.id, `race${index}`),
    );
    const settled = await Promise.allSettled(attempts);

    const created = settled.filter((r) => r.status === 'fulfilled').length;
    expect(created).toBeLessThanOrEqual(3);
    expect(await prisma.invoice.count({ where: { userId } })).toBe(created);
    expect(await prisma.invoice.count({ where: { userId } })).toBeLessThanOrEqual(3);
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Data at rest
// ---------------------------------------------------------------------------

describe('data at rest', () => {
  it('the billing table holds Stripe identifiers only — no card data', async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'billing'
    `;
    const names = columns.map((row) => row.column_name.toLowerCase());

    for (const forbidden of ['card', 'cvv', 'cvc', 'pan', 'expiry', 'exp_month', 'cardholder']) {
      expect(names.some((name) => name.includes(forbidden))).toBe(false);
    }

    expect(names).toContain('customerid');
    expect(names).toContain('subscriptionid');
  });

  it('no table anywhere has a column that looks like a payment credential', async () => {
    const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
    `;

    const suspicious = columns.filter((row) =>
      /card_?number|cardnumber|\bcvv\b|\bcvc\b|security_?code|cardholder/i.test(
        row.column_name,
      ),
    );

    expect(suspicious).toEqual([]);
  });

  it('passwords are stored only as scrypt hashes', async () => {
    const userId = await createUser();
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    expect(row?.passwordHash).toMatch(/^scrypt\$/);
    expect(row?.passwordHash).not.toContain('Passw0rd-test');
  });
});
