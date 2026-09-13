import { afterAll, describe, expect, it } from 'vitest';

import { prisma } from '@/server/db/prisma';
import { createInvoiceForUser, getInvoiceForUser } from '@/server/db/invoices';
import { calculateInvoiceTotals } from '@/domain/tax';
import { hashPassword } from '@/server/auth/password';

/**
 * Round-trip tests against the real database: create → save → reopen, plus the
 * ownership rule that stops one account attaching invoices to another's client.
 */

const createdUserIds: string[] = [];

async function createUser() {
  const user = await prisma.user.create({
    data: {
      email: `persist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
      passwordHash: await hashPassword('Passw0rd-test'),
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createClient(userId: string, name = '取引先 太郎') {
  return prisma.client.create({
    data: { userId, name, companyName: '取引先株式会社' },
    select: { id: true },
  });
}

function writeInput(clientId: string, overrides: Record<string, unknown> = {}) {
  const items = [
    { description: '制作費', quantity: 1, unitPrice: 100_000, taxRate: 10 },
    { description: '書籍（軽減税率）', quantity: 3, unitPrice: 1_500, taxRate: 8 },
  ];
  const totals = calculateInvoiceTotals(items);

  return {
    clientId,
    invoiceNumber: `INV-P-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    issueDate: new Date('2026-09-01T00:00:00.000Z'),
    dueDate: new Date('2026-09-30T00:00:00.000Z'),
    notes: '振込先：○○銀行 普通 1234567',
    subtotal: totals.subtotal,
    tax8: totals.tax8,
    tax10: totals.tax10,
    total: totals.total,
    issuerName: '株式会社インボイス',
    issuerAddress: '〒150-0001\n東京都渋谷区神宮前2-2-2',
    issuerPhone: '03-5555-0123',
    issuerEmail: 'billing@example.com',
    issuerRegistrationNumber: 'T9234567890123',
    clientNameSnapshot: '取引先株式会社',
    clientAddressSnapshot: '〒100-0001\n東京都千代田区千代田1-1',
    clientEmailSnapshot: 'contact@example.com',
    items: items.map((line, index) => ({
      ...line,
      amount: totals.lineAmounts[index] ?? 0,
    })),
    ...overrides,
  };
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe('請求書の保存と再読み込み (create → save → reopen)', () => {
  it('stores an invoice and reads every field back unchanged', async () => {
    const user = await createUser();
    const client = await createClient(user.id);

    const created = await createInvoiceForUser(user.id, writeInput(client.id));

    // Reopen through the same code path the detail page uses.
    const reopened = await getInvoiceForUser(user.id, created.id);
    expect(reopened).not.toBeNull();
    if (!reopened) return;

    expect(reopened.invoiceNumber).toBe(created.invoiceNumber);
    expect(reopened.issueDate).toBe('2026-09-01');
    expect(reopened.dueDate).toBe('2026-09-30');
    expect(reopened.notes).toBe('振込先：○○銀行 普通 1234567');

    // 104,500 税抜 / 8%: 4,500 → 360 / 10%: 100,000 → 10,000
    expect(reopened.subtotal).toBe(104_500);
    expect(reopened.tax8).toBe(360);
    expect(reopened.tax10).toBe(10_000);
    expect(reopened.total).toBe(114_860);
    expect(reopened.total).toBe(reopened.subtotal + reopened.tax8 + reopened.tax10);

    expect(reopened.items).toHaveLength(2);
    expect(reopened.items[0]?.description).toBe('制作費');
    expect(reopened.items[1]?.taxRate).toBe(8);
    expect(reopened.items[1]?.amount).toBe(4_500);
  });

  it('returns the parties from the invoice snapshot, not the live records', async () => {
    const user = await createUser();
    const client = await createClient(user.id);

    const created = await createInvoiceForUser(user.id, writeInput(client.id));

    // Rename the client after the invoice was issued.
    await prisma.client.updateMany({
      where: { id: client.id, userId: user.id },
      data: { name: '改名後 太郎', companyName: '改名後株式会社' },
    });

    const reopened = await getInvoiceForUser(user.id, created.id);
    expect(reopened?.parties.billTo.name).toBe('取引先株式会社');
    expect(reopened?.parties.billTo.name).not.toBe('改名後株式会社');

    expect(reopened?.parties.issuer).toEqual({
      name: '株式会社インボイス',
      address: '〒150-0001\n東京都渋谷区神宮前2-2-2',
      phone: '03-5555-0123',
      email: 'billing@example.com',
      registrationNumber: 'T9234567890123',
    });
  });

  it('preserves Japanese text through the database round trip', async () => {
    const user = await createUser();
    const client = await createClient(user.id);

    const japanese = 'ウェブサイト制作費（税込）〒１００ ｱｲｳ 漢字ひらがなカタカナ';
    const created = await createInvoiceForUser(
      user.id,
      writeInput(client.id, {
        notes: japanese,
        items: [
          {
            description: japanese,
            quantity: 1,
            unitPrice: 1000,
            taxRate: 10,
            amount: 1000,
          },
        ],
        subtotal: 1000,
        tax8: 0,
        tax10: 100,
        total: 1100,
      }),
    );

    const reopened = await getInvoiceForUser(user.id, created.id);
    expect(reopened?.notes).toBe(japanese);
    expect(reopened?.items[0]?.description).toBe(japanese);
  });

  it('stores an XSS payload verbatim as text — escaping belongs at render time', async () => {
    const user = await createUser();
    const client = await createClient(user.id);

    const payload = '<script>alert(1)</script>';
    const created = await createInvoiceForUser(
      user.id,
      writeInput(client.id, {
        clientNameSnapshot: payload,
        notes: payload,
      }),
    );

    const reopened = await getInvoiceForUser(user.id, created.id);
    expect(reopened?.parties.billTo.name).toBe(payload);
    expect(reopened?.notes).toBe(payload);
  });
});

describe('所有権の検証 (client belongs to the authenticated user)', () => {
  it("refuses to bill another account's client", async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const victimClient = await createClient(owner.id, '被害者 太郎');

    await expect(
      createInvoiceForUser(attacker.id, writeInput(victimClient.id)),
    ).rejects.toThrow(/顧客が見つかりませんでした/);

    // Nothing was written.
    const count = await prisma.invoice.count({ where: { userId: attacker.id } });
    expect(count).toBe(0);
  });

  it('refuses a client id that does not exist at all', async () => {
    const user = await createUser();

    await expect(
      createInvoiceForUser(user.id, writeInput('clnonexistent000000000000')),
    ).rejects.toThrow(/顧客が見つかりませんでした/);
  });

  it("does not return another account's invoice", async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const client = await createClient(owner.id);

    const invoice = await createInvoiceForUser(owner.id, writeInput(client.id));

    expect(await getInvoiceForUser(attacker.id, invoice.id)).toBeNull();
    expect(await getInvoiceForUser(owner.id, invoice.id)).not.toBeNull();
  });

  it('rejects a duplicate invoice number for the same account', async () => {
    const user = await createUser();
    const client = await createClient(user.id);

    const input = writeInput(client.id);
    await createInvoiceForUser(user.id, input);

    await expect(createInvoiceForUser(user.id, input)).rejects.toThrow(
      /すでに使用されています/,
    );
  });

  it('allows two accounts to use the same invoice number independently', async () => {
    const first = await createUser();
    const second = await createUser();
    const firstClient = await createClient(first.id);
    const secondClient = await createClient(second.id);

    const invoiceNumber = `INV-SHARED-${Date.now()}`;

    await createInvoiceForUser(first.id, writeInput(firstClient.id, { invoiceNumber }));
    await expect(
      createInvoiceForUser(second.id, writeInput(secondClient.id, { invoiceNumber })),
    ).resolves.toMatchObject({ invoiceNumber });
  });
});

describe('データベース制約 (snapshot constraints)', () => {
  it('rejects a malformed issuer registration number at the database level', async () => {
    const user = await createUser();
    const client = await createClient(user.id);

    await expect(
      prisma.invoice.create({
        data: {
          userId: user.id,
          clientId: client.id,
          invoiceNumber: `INV-BAD-${Date.now()}`,
          issueDate: new Date('2026-09-01T00:00:00.000Z'),
          dueDate: new Date('2026-09-30T00:00:00.000Z'),
          subtotal: 1000,
          tax8: 0,
          tax10: 100,
          total: 1100,
          issuerRegistrationNumber: 'NOT-A-NUMBER',
        },
      }),
    ).rejects.toThrow();
  });
});
