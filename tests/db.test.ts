import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '@/server/db/prisma';
import { checkDatabaseConnection } from '@/server/db/health';
import { calculateInvoiceTotals } from '@/domain/tax';
import { hashPassword, verifyPassword } from '@/server/auth/password';

/**
 * Database-backed tests.
 *
 * These run against the real PostgreSQL instance named by DATABASE_URL, so they
 * also prove that the Prisma migration matches the schema the code expects.
 * Every row created here is removed in `afterAll`, and each test uses a unique
 * email so a re-run never collides.
 */

const TEST_EMAIL_PREFIX = 'vitest-';
const createdUserIds: string[] = [];

function uniqueEmail(): string {
  return `${TEST_EMAIL_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

async function createTestUser() {
  const user = await prisma.user.create({
    data: { email: uniqueEmail(), passwordHash: await hashPassword('Passw0rd-test') },
    select: { id: true, email: true },
  });
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    // Cascades remove companies, clients, invoices and invoice items.
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe('データベース接続 (database connection)', () => {
  it('connects and answers a trivial query', async () => {
    await expect(checkDatabaseConnection()).resolves.toBe(true);
  });

  it('exposes every model the application uses', async () => {
    // Counts on tenant-owned models are scoped by user — the tenant guard
    // refuses an unscoped query, which is the behaviour we want everywhere.
    const user = await createTestUser();

    await expect(prisma.user.count()).resolves.toBeTypeOf('number');
    await expect(
      prisma.company.count({ where: { userId: user.id } }),
    ).resolves.toBeTypeOf('number');
    await expect(
      prisma.client.count({ where: { userId: user.id } }),
    ).resolves.toBeTypeOf('number');
    await expect(
      prisma.invoice.count({ where: { userId: user.id } }),
    ).resolves.toBeTypeOf('number');
    await expect(
      prisma.invoiceItem.count({ where: { invoice: { userId: user.id } } }),
    ).resolves.toBeTypeOf('number');
  });

  it('has applied the migrations', async () => {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('users', 'companies', 'clients', 'invoices', 'invoice_items')
    `;

    expect(Number(rows[0]?.count)).toBe(5);
  });
});

describe('パスワードハッシュ (password hashing)', () => {
  it('round-trips a password without storing it in the clear', async () => {
    const hash = await hashPassword('correct horse battery staple 1');

    expect(hash).not.toContain('correct horse');
    expect(hash.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword('correct horse battery staple 1', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong password 1', hash)).resolves.toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const [first, second] = await Promise.all([
      hashPassword('same-password-1'),
      hashPassword('same-password-1'),
    ]);

    expect(first).not.toBe(second);
  });

  it('returns false rather than throwing for a null or malformed hash', async () => {
    await expect(verifyPassword('anything', null)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('anything', 'scrypt$1$2$3$4$5')).resolves.toBe(false);
  });
});

describe('請求書の永続化 (invoice persistence)', () => {
  it('stores an invoice with its items and reads the amounts back intact', async () => {
    const user = await createTestUser();

    const client = await prisma.client.create({
      data: { userId: user.id, name: '検証 太郎', companyName: '検証株式会社' },
      select: { id: true },
    });

    const items = [
      { description: '制作費', quantity: 1, unitPrice: 100_000, taxRate: 10 },
      { description: '書籍（軽減税率）', quantity: 3, unitPrice: 1_500, taxRate: 8 },
    ];
    const totals = calculateInvoiceTotals(items);

    const invoice = await prisma.invoice.create({
      data: {
        userId: user.id,
        clientId: client.id,
        invoiceNumber: `INV-TEST-${Date.now()}`,
        issueDate: new Date('2026-09-01T00:00:00.000Z'),
        dueDate: new Date('2026-09-30T00:00:00.000Z'),
        subtotal: totals.subtotal,
        tax8: totals.tax8,
        tax10: totals.tax10,
        total: totals.total,
        items: {
          create: items.map((item, index) => ({
            ...item,
            amount: totals.lineAmounts[index] ?? 0,
            position: index,
          })),
        },
      },
      select: { id: true },
    });

    const stored = await prisma.invoice.findFirstOrThrow({
      where: { id: invoice.id, userId: user.id },
      include: { items: { orderBy: { position: 'asc' } } },
    });

    expect(stored.subtotal).toBe(104_500);
    expect(stored.tax10).toBe(10_000);
    expect(stored.tax8).toBe(360);
    expect(stored.total).toBe(114_860);
    expect(stored.total).toBe(stored.subtotal + stored.tax8 + stored.tax10);

    expect(stored.items).toHaveLength(2);
    expect(Number(stored.items[0]?.quantity)).toBe(1);
    expect(Number(stored.items[1]?.unitPrice)).toBe(1500);
    expect(stored.items[1]?.amount).toBe(4500);
  });

  it('rejects a duplicate invoice number for the same user', async () => {
    const user = await createTestUser();
    const client = await prisma.client.create({
      data: { userId: user.id, name: '重複 検証' },
      select: { id: true },
    });

    const payload = {
      userId: user.id,
      clientId: client.id,
      invoiceNumber: 'INV-DUP-0001',
      issueDate: new Date('2026-09-01T00:00:00.000Z'),
      dueDate: new Date('2026-09-30T00:00:00.000Z'),
      subtotal: 1000,
      tax8: 0,
      tax10: 100,
      total: 1100,
    };

    await prisma.invoice.create({ data: payload });
    await expect(prisma.invoice.create({ data: payload })).rejects.toThrow();
  });
});

describe('データベース制約 (database-level integrity constraints)', () => {
  it('rejects a tax rate other than 8 or 10', async () => {
    const user = await createTestUser();
    const client = await prisma.client.create({
      data: { userId: user.id, name: '制約 検証' },
      select: { id: true },
    });

    await expect(
      prisma.invoice.create({
        data: {
          userId: user.id,
          clientId: client.id,
          invoiceNumber: `INV-RATE-${Date.now()}`,
          issueDate: new Date('2026-09-01T00:00:00.000Z'),
          dueDate: new Date('2026-09-30T00:00:00.000Z'),
          subtotal: 1000,
          tax8: 0,
          tax10: 50,
          total: 1050,
          items: {
            create: [
              { description: '不正な税率', quantity: 1, unitPrice: 1000, taxRate: 5, amount: 1000 },
            ],
          },
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a negative quantity and a negative unit price', async () => {
    const user = await createTestUser();
    const client = await prisma.client.create({
      data: { userId: user.id, name: '負値 検証' },
      select: { id: true },
    });

    const invoice = await prisma.invoice.create({
      data: {
        userId: user.id,
        clientId: client.id,
        invoiceNumber: `INV-NEG-${Date.now()}`,
        issueDate: new Date('2026-09-01T00:00:00.000Z'),
        dueDate: new Date('2026-09-30T00:00:00.000Z'),
        subtotal: 0,
        tax8: 0,
        tax10: 0,
        total: 0,
      },
      select: { id: true },
    });

    await expect(
      prisma.invoiceItem.create({
        data: {
          invoiceId: invoice.id,
          description: '負の数量',
          quantity: -1,
          unitPrice: 1000,
          taxRate: 10,
          amount: 0,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.invoiceItem.create({
        data: {
          invoiceId: invoice.id,
          description: '負の単価',
          quantity: 1,
          unitPrice: -1000,
          taxRate: 10,
          amount: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a total that does not equal subtotal + tax', async () => {
    const user = await createTestUser();
    const client = await prisma.client.create({
      data: { userId: user.id, name: '合計 検証' },
      select: { id: true },
    });

    await expect(
      prisma.invoice.create({
        data: {
          userId: user.id,
          clientId: client.id,
          invoiceNumber: `INV-SUM-${Date.now()}`,
          issueDate: new Date('2026-09-01T00:00:00.000Z'),
          dueDate: new Date('2026-09-30T00:00:00.000Z'),
          subtotal: 100_000,
          tax8: 0,
          tax10: 10_000,
          total: 1, // a tampered client could claim this
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a registration number that is not T + 13 digits', async () => {
    const user = await createTestUser();

    await expect(
      prisma.company.create({
        data: {
          userId: user.id,
          name: '不正 株式会社',
          address: '東京都',
          phone: '03-0000-0000',
          email: 'bad@example.test',
          registrationNumber: '1234567890123',
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a due date earlier than the issue date', async () => {
    const user = await createTestUser();
    const client = await prisma.client.create({
      data: { userId: user.id, name: '期日 検証' },
      select: { id: true },
    });

    await expect(
      prisma.invoice.create({
        data: {
          userId: user.id,
          clientId: client.id,
          invoiceNumber: `INV-DATE-${Date.now()}`,
          issueDate: new Date('2026-09-30T00:00:00.000Z'),
          dueDate: new Date('2026-09-01T00:00:00.000Z'),
          subtotal: 0,
          tax8: 0,
          tax10: 0,
          total: 0,
        },
      }),
    ).rejects.toThrow();
  });
});
