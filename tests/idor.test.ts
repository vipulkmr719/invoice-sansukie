import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/server/db/prisma';
import { hashPassword } from '@/server/auth/password';
import { calculateInvoiceTotals } from '@/domain/tax';
import {
  createInvoiceForUser,
  deleteInvoiceForUser,
  getInvoiceForUser,
  listInvoicesForUser,
  getDashboardStats,
  suggestInvoiceNumber,
} from '@/server/db/invoices';
import {
  createClientForUser,
  deleteClientForUser,
  getClientForUser,
  listClientsForUser,
  listClientsWithStats,
  updateClientForUser,
} from '@/server/db/clients';
import { getCompanyForUser, upsertCompanyForUser } from '@/server/db/companies';
import { renderInvoiceHtml } from '@/server/pdf/invoice-template';

/**
 * IDOR / multi-tenant isolation suite.
 *
 * Two accounts exist. User A owns everything; User B knows the ids and tries
 * every way in. The rule under test: an id belonging to another tenant must be
 * indistinguishable from an id that does not exist — no data, no partial data,
 * no "forbidden" that confirms the row is real.
 */

interface Tenant {
  userId: string;
  clientId: string;
  invoiceId: string;
  invoiceNumber: string;
  companyId: string;
}

const createdUserIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `idor-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
      passwordHash: await hashPassword('Passw0rd-test'),
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function seedTenant(label: string): Promise<Tenant> {
  const userId = await createUser(label);

  const company = await upsertCompanyForUser(userId, {
    name: `${label}株式会社`,
    address: `${label}県${label}市1-1`,
    phone: '03-0000-0000',
    email: `${label}@example.test`,
    registrationNumber: 'T9234567890123',
  });

  const client = await createClientForUser(userId, {
    name: `${label}の顧客`,
    companyName: `${label}商事`,
    address: `${label}県${label}市2-2`,
    email: `client-${label}@example.test`,
    phone: '03-1111-2222',
  });

  const items = [
    { description: `${label}の制作費`, quantity: 1, unitPrice: 100_000, taxRate: 10 },
  ];
  const totals = calculateInvoiceTotals(items);

  const invoiceNumber = `INV-${label.toUpperCase()}-001`;
  const invoice = await createInvoiceForUser(userId, {
    clientId: client.id,
    invoiceNumber,
    issueDate: new Date('2026-09-01T00:00:00.000Z'),
    dueDate: new Date('2026-09-30T00:00:00.000Z'),
    notes: `${label}の機密メモ`,
    subtotal: totals.subtotal,
    tax8: totals.tax8,
    tax10: totals.tax10,
    total: totals.total,
    issuerName: `${label}株式会社`,
    issuerAddress: `${label}県${label}市1-1`,
    issuerPhone: '03-0000-0000',
    issuerEmail: `${label}@example.test`,
    issuerRegistrationNumber: 'T9234567890123',
    clientNameSnapshot: `${label}商事`,
    clientAddressSnapshot: `${label}県${label}市2-2`,
    clientEmailSnapshot: `client-${label}@example.test`,
    items: items.map((line, index) => ({
      ...line,
      amount: totals.lineAmounts[index] ?? 0,
    })),
  });

  return {
    userId,
    clientId: client.id,
    invoiceId: invoice.id,
    invoiceNumber,
    companyId: company.id,
  };
}

let userA: Tenant;
let userB: Tenant;

beforeAll(async () => {
  userA = await seedTenant('alpha');
  userB = await seedTenant('bravo');
}, 60_000);

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

describe('IDOR: 請求書 (User B → User A の請求書ID)', () => {
  it("returns null for another tenant's invoice id", async () => {
    const result = await getInvoiceForUser(userB.userId, userA.invoiceId);
    expect(result).toBeNull();
  });

  it('is indistinguishable from an id that does not exist', async () => {
    const foreign = await getInvoiceForUser(userB.userId, userA.invoiceId);
    const missing = await getInvoiceForUser(userB.userId, 'clnonexistent0000000000000');
    expect(foreign).toEqual(missing);
  });

  it('the owner can still read it — the test is not passing vacuously', async () => {
    const result = await getInvoiceForUser(userA.userId, userA.invoiceId);
    expect(result).not.toBeNull();
    expect(result?.invoiceNumber).toBe(userA.invoiceNumber);
    expect(result?.notes).toBe('alphaの機密メモ');
  });

  it("never lists another tenant's invoices", async () => {
    const listed = await listInvoicesForUser(userB.userId);
    expect(listed.map((invoice) => invoice.id)).not.toContain(userA.invoiceId);
    expect(listed.every((invoice) => invoice.id === userB.invoiceId)).toBe(true);
  });

  it("filtering by another tenant's client id yields nothing", async () => {
    const listed = await listInvoicesForUser(userB.userId, { clientId: userA.clientId });
    expect(listed).toEqual([]);
  });

  it("refuses to delete another tenant's invoice, and the row survives", async () => {
    await expect(
      deleteInvoiceForUser(userB.userId, userA.invoiceId),
    ).rejects.toThrow(/請求書が見つかりませんでした/);

    expect(await getInvoiceForUser(userA.userId, userA.invoiceId)).not.toBeNull();
  });

  it("cannot attach a new invoice to another tenant's client", async () => {
    await expect(
      createInvoiceForUser(userB.userId, {
        clientId: userA.clientId,
        invoiceNumber: `INV-STEAL-${Date.now()}`,
        issueDate: new Date('2026-09-01T00:00:00.000Z'),
        dueDate: new Date('2026-09-30T00:00:00.000Z'),
        notes: null,
        subtotal: 1000,
        tax8: 0,
        tax10: 100,
        total: 1100,
        issuerName: 'bravo株式会社',
        issuerAddress: 'bravo県',
        issuerPhone: '03-0000-0000',
        issuerEmail: 'bravo@example.test',
        issuerRegistrationNumber: 'T9234567890123',
        clientNameSnapshot: '乗っ取り',
        clientAddressSnapshot: null,
        clientEmailSnapshot: null,
        items: [
          { description: 'x', quantity: 1, unitPrice: 1000, taxRate: 10, amount: 1000 },
        ],
      }),
    ).rejects.toThrow(/顧客が見つかりませんでした/);
  });

  it("the database itself refuses a cross-tenant client link", async () => {
    // Bypassing the repository entirely: the composite foreign key
    // (clientId, userId) -> clients(id, userId) makes this impossible.
    await expect(
      prisma.invoice.create({
        data: {
          userId: userB.userId,
          clientId: userA.clientId,
          invoiceNumber: `INV-FK-${Date.now()}`,
          issueDate: new Date('2026-09-01T00:00:00.000Z'),
          dueDate: new Date('2026-09-30T00:00:00.000Z'),
          subtotal: 1000,
          tax8: 0,
          tax10: 100,
          total: 1100,
        },
      }),
    ).rejects.toThrow();
  });

  it("invoice numbering does not leak another tenant's sequence", async () => {
    // User A used INV-ALPHA-001; User B's suggestion is derived only from its
    // own invoices.
    const suggestion = await suggestInvoiceNumber(userB.userId, 2026);
    expect(suggestion).toBe('INV-2026-0001');
  });
});

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

describe('IDOR: 顧客 (User B → User A の顧客ID)', () => {
  it("returns null for another tenant's client id", async () => {
    expect(await getClientForUser(userB.userId, userA.clientId)).toBeNull();
  });

  it('the owner can still read it', async () => {
    const client = await getClientForUser(userA.userId, userA.clientId);
    expect(client?.companyName).toBe('alpha商事');
  });

  it("never lists another tenant's clients", async () => {
    const listed = await listClientsForUser(userB.userId);
    expect(listed.map((client) => client.id)).not.toContain(userA.clientId);

    const withStats = await listClientsWithStats(userB.userId);
    expect(withStats.map((client) => client.id)).not.toContain(userA.clientId);
  });

  it("refuses to update another tenant's client, and the row is unchanged", async () => {
    await expect(
      updateClientForUser(userB.userId, userA.clientId, {
        name: '改ざん',
        companyName: '改ざん',
        address: null,
        email: null,
        phone: null,
      }),
    ).rejects.toThrow(/顧客が見つかりませんでした/);

    const untouched = await getClientForUser(userA.userId, userA.clientId);
    expect(untouched?.name).toBe('alphaの顧客');
    expect(untouched?.companyName).toBe('alpha商事');
  });

  it("refuses to delete another tenant's client, and the row survives", async () => {
    await expect(
      deleteClientForUser(userB.userId, userA.clientId),
    ).rejects.toThrow();

    expect(await getClientForUser(userA.userId, userA.clientId)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Company settings
// ---------------------------------------------------------------------------

describe('IDOR: 自社情報 (company settings)', () => {
  it('each tenant sees only its own company', async () => {
    const a = await getCompanyForUser(userA.userId);
    const b = await getCompanyForUser(userB.userId);

    expect(a?.name).toBe('alpha株式会社');
    expect(b?.name).toBe('bravo株式会社');
    expect(a?.id).not.toBe(b?.id);
  });

  it("writing one tenant's settings never touches the other's", async () => {
    await upsertCompanyForUser(userB.userId, {
      name: 'bravo改名',
      address: 'bravo県bravo市9-9',
      phone: '06-9999-9999',
      email: 'new-bravo@example.test',
      registrationNumber: 'T9234567890123',
    });

    const a = await getCompanyForUser(userA.userId);
    expect(a?.name).toBe('alpha株式会社');
    expect(a?.id).toBe(userA.companyId);
  });
});

// ---------------------------------------------------------------------------
// Invoice items
// ---------------------------------------------------------------------------

describe('IDOR: 請求明細 (invoice items)', () => {
  it("cannot read another tenant's items through a bare invoiceId", async () => {
    // The tenant guard refuses a direct, unscoped InvoiceItem query.
    await expect(
      prisma.invoiceItem.findMany({ where: { invoiceId: userA.invoiceId } }),
    ).rejects.toThrow(/Refused an unscoped/);
  });

  it('a scoped item query returns nothing for the wrong tenant', async () => {
    const items = await prisma.invoiceItem.findMany({
      where: { invoiceId: userA.invoiceId, invoice: { userId: userB.userId } },
    });
    expect(items).toEqual([]);
  });

  it('…and returns the rows for the right tenant', async () => {
    const items = await prisma.invoiceItem.findMany({
      where: { invoiceId: userA.invoiceId, invoice: { userId: userA.userId } },
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.description).toBe('alphaの制作費');
  });
});

// ---------------------------------------------------------------------------
// Dashboard aggregates
// ---------------------------------------------------------------------------

describe('IDOR: ダッシュボード集計', () => {
  it("one tenant's totals never include the other's invoices", async () => {
    const statsA = await getDashboardStats(userA.userId);
    const statsB = await getDashboardStats(userB.userId);

    expect(statsA.invoiceCount).toBe(1);
    expect(statsB.invoiceCount).toBe(1);
    expect(statsA.totalBilled).toBe(110_000);
    expect(statsB.totalBilled).toBe(110_000);

    expect(statsB.recentInvoices.map((invoice) => invoice.id)).not.toContain(
      userA.invoiceId,
    );
  });
});

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

describe('IDOR: PDF 生成', () => {
  it("cannot obtain the data needed to render another tenant's PDF", async () => {
    // The PDF route renders whatever getInvoiceForUser returns; for a foreign
    // id that is null, so there is nothing to render.
    const invoice = await getInvoiceForUser(userB.userId, userA.invoiceId);
    expect(invoice).toBeNull();
  });

  it("the owner's PDF HTML contains their data and not the other tenant's", async () => {
    const invoice = await getInvoiceForUser(userA.userId, userA.invoiceId);
    expect(invoice).not.toBeNull();

    const markup = renderInvoiceHtml(invoice!);
    expect(markup).toContain('alpha株式会社');
    expect(markup).toContain('alphaの制作費');
    expect(markup).not.toContain('bravo');
  });
});

// ---------------------------------------------------------------------------
// Cascade safety
// ---------------------------------------------------------------------------

describe('カスケードの安全性', () => {
  it('deleting a user removes exactly that tenant and nothing else', async () => {
    const victim = await seedTenant('charlie');

    const beforeA = await getInvoiceForUser(userA.userId, userA.invoiceId);
    expect(beforeA).not.toBeNull();

    // Cascades through company, clients, invoices and invoice items in one
    // statement — this is the case the NO ACTION foreign key makes reliable.
    await prisma.user.deleteMany({ where: { id: victim.userId } });

    expect(await getInvoiceForUser(victim.userId, victim.invoiceId)).toBeNull();
    expect(await getClientForUser(victim.userId, victim.clientId)).toBeNull();
    expect(await getCompanyForUser(victim.userId)).toBeNull();
    expect(
      await prisma.invoiceItem.count({ where: { invoice: { userId: victim.userId } } }),
    ).toBe(0);

    // The other tenant is untouched.
    const afterA = await getInvoiceForUser(userA.userId, userA.invoiceId);
    expect(afterA).not.toBeNull();
    expect(afterA?.invoiceNumber).toBe(userA.invoiceNumber);
  }, 60_000);

  it('a client that still has invoices cannot be deleted', async () => {
    await expect(
      deleteClientForUser(userA.userId, userA.clientId),
    ).rejects.toThrow(/請求書が紐づいているため削除できません/);

    expect(await getClientForUser(userA.userId, userA.clientId)).not.toBeNull();
  });
});
