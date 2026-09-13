import { describe, expect, it } from 'vitest';

import { invoiceItemSchema, invoiceSchema } from '@/validation/invoice';
import { companySchema } from '@/validation/company';
import { clientSchema } from '@/validation/client';

const CLIENT_ID = 'clh1234567890abcdefghijk';

function baseInvoice(overrides: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_ID,
    invoiceNumber: 'INV-2026-0001',
    issueDate: '2026-09-01',
    dueDate: '2026-09-30',
    notes: '',
    items: [{ description: 'コンサルティング費', quantity: 1, unitPrice: 100000, taxRate: 10 }],
    ...overrides,
  };
}

/** First error message for a given field path. */
function messageFor(result: { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } }, field: string) {
  return result.error.issues.find((issue) => issue.path.includes(field))?.message;
}

describe('請求書の検証 (invoice creation validation)', () => {
  it('accepts a well-formed invoice', () => {
    const result = invoiceSchema.safeParse(baseInvoice());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.issueDate.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(result.data.notes).toBeNull();
    }
  });

  it('coerces numeric strings, as they arrive from FormData', () => {
    const result = invoiceSchema.safeParse(
      baseInvoice({
        items: [{ description: '作業費', quantity: '2.5', unitPrice: '1200', taxRate: '8' }],
      }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0]).toMatchObject({
        quantity: 2.5,
        unitPrice: 1200,
        taxRate: 8,
      });
    }
  });

  it('requires at least one line item', () => {
    const result = invoiceSchema.safeParse(baseInvoice({ items: [] }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messageFor(result, 'items')).toMatch(/1件以上/);
    }
  });

  it('requires a description on each line', () => {
    const result = invoiceSchema.safeParse(
      baseInvoice({ items: [{ description: '   ', quantity: 1, unitPrice: 100, taxRate: 10 }] }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messageFor(result, 'description')).toMatch(/品目を入力/);
    }
  });

  it('rejects a due date earlier than the issue date', () => {
    const result = invoiceSchema.safeParse(
      baseInvoice({ issueDate: '2026-09-30', dueDate: '2026-09-01' }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messageFor(result, 'dueDate')).toMatch(/発行日以降/);
    }
  });

  it('rejects a malformed date', () => {
    const result = invoiceSchema.safeParse(baseInvoice({ issueDate: '2026/09/01' }));
    expect(result.success).toBe(false);
  });

  it('rejects a missing or malformed client id', () => {
    expect(invoiceSchema.safeParse(baseInvoice({ clientId: '' })).success).toBe(false);
    expect(
      invoiceSchema.safeParse(baseInvoice({ clientId: "'; DROP TABLE invoices; --" })).success,
    ).toBe(false);
  });

  it('rejects an invoice number with unexpected characters', () => {
    expect(invoiceSchema.safeParse(baseInvoice({ invoiceNumber: 'INV 2026 0001' })).success).toBe(false);
    expect(invoiceSchema.safeParse(baseInvoice({ invoiceNumber: '<script>' })).success).toBe(false);
  });
});

describe('明細の税率 (invalid tax rate)', () => {
  it.each([0, 5, 7, 9, 11, 20, -10])('rejects a tax rate of %s%%', (taxRate) => {
    const result = invoiceItemSchema.safeParse({
      description: '商品',
      quantity: 1,
      unitPrice: 1000,
      taxRate,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messageFor(result, 'taxRate')).toMatch(/8%|税率/);
    }
  });

  it.each([8, 10])('accepts a tax rate of %s%%', (taxRate) => {
    expect(
      invoiceItemSchema.safeParse({
        description: '商品',
        quantity: 1,
        unitPrice: 1000,
        taxRate,
      }).success,
    ).toBe(true);
  });
});

describe('数量の検証 (negative quantity)', () => {
  it.each([-1, -0.5, -1000])('rejects a quantity of %s', (quantity) => {
    const result = invoiceItemSchema.safeParse({
      description: '商品',
      quantity,
      unitPrice: 1000,
      taxRate: 10,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messageFor(result, 'quantity')).toMatch(/負の値/);
    }
  });

  it('rejects a quantity of zero', () => {
    const result = invoiceItemSchema.safeParse({
      description: '商品',
      quantity: 0,
      unitPrice: 1000,
      taxRate: 10,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a quantity beyond the supported range', () => {
    expect(
      invoiceItemSchema.safeParse({
        description: '商品',
        quantity: 10_000_000,
        unitPrice: 1000,
        taxRate: 10,
      }).success,
    ).toBe(false);
  });

  it('rejects a non-numeric quantity', () => {
    for (const quantity of ['', '   ', 'abc', 'NaN', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        invoiceItemSchema.safeParse({
          description: '商品',
          quantity,
          unitPrice: 1000,
          taxRate: 10,
        }).success,
      ).toBe(false);
    }
  });

  it('accepts a fractional quantity within 3 decimal places', () => {
    expect(
      invoiceItemSchema.safeParse({
        description: '作業',
        quantity: 1.125,
        unitPrice: 1000,
        taxRate: 10,
      }).success,
    ).toBe(true);

    expect(
      invoiceItemSchema.safeParse({
        description: '作業',
        quantity: 1.1255,
        unitPrice: 1000,
        taxRate: 10,
      }).success,
    ).toBe(false);
  });
});

describe('単価の検証 (negative price)', () => {
  it.each([-1, -0.01, -100000])('rejects a unit price of %s', (unitPrice) => {
    const result = invoiceItemSchema.safeParse({
      description: '商品',
      quantity: 1,
      unitPrice,
      taxRate: 10,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messageFor(result, 'unitPrice')).toMatch(/負の値/);
    }
  });

  it('accepts a unit price of zero', () => {
    expect(
      invoiceItemSchema.safeParse({
        description: 'サービス（無償提供）',
        quantity: 1,
        unitPrice: 0,
        taxRate: 10,
      }).success,
    ).toBe(true);
  });

  it('rejects a unit price beyond the supported range', () => {
    expect(
      invoiceItemSchema.safeParse({
        description: '商品',
        quantity: 1,
        unitPrice: 1_000_000_000,
        taxRate: 10,
      }).success,
    ).toBe(false);
  });

  it('rejects a unit price with more than 2 decimal places', () => {
    expect(
      invoiceItemSchema.safeParse({
        description: '商品',
        quantity: 1,
        unitPrice: 100.005,
        taxRate: 10,
      }).success,
    ).toBe(false);
  });
});

describe('自社情報の検証 (invalid registration number)', () => {
  const validCompany = {
    name: '株式会社サンプル',
    address: '東京都千代田区千代田1-1',
    phone: '03-1234-5678',
    email: 'info@example.com',
    registrationNumber: 'T9234567890123',
  };

  it('accepts a valid company', () => {
    const result = companySchema.safeParse(validCompany);
    expect(result.success).toBe(true);
  });

  it('normalises a hyphenated, lower-case, full-width registration number', () => {
    const result = companySchema.safeParse({
      ...validCompany,
      registrationNumber: ' t9234-5678-90123 ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.registrationNumber).toBe('T9234567890123');
    }
  });

  it.each([
    ['', 'empty'],
    ['1234567890123', 'no T prefix'],
    ['T123456789012', 'too short'],
    ['T12345678901234', 'too long'],
    ['TABCDEFGHIJKLM', 'letters instead of digits'],
    ['X9234567890123', 'wrong prefix'],
  ])('rejects the registration number %o (%s)', (registrationNumber) => {
    const result = companySchema.safeParse({ ...validCompany, registrationNumber });
    expect(result.success).toBe(false);
  });

  it('rejects a well-formed registration number with a bad check digit', () => {
    const result = companySchema.safeParse({
      ...validCompany,
      registrationNumber: 'T1234567890123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messageFor(result, 'registrationNumber')).toMatch(/チェックデジット/);
    }
  });

  it('requires every other company field', () => {
    for (const field of ['name', 'address', 'phone', 'email'] as const) {
      const result = companySchema.safeParse({ ...validCompany, [field]: '  ' });
      expect(result.success).toBe(false);
    }
  });

  it('rejects a malformed company email', () => {
    expect(
      companySchema.safeParse({ ...validCompany, email: 'not-an-email' }).success,
    ).toBe(false);
  });
});

describe('顧客の検証 (client validation)', () => {
  it('requires a name but treats the rest as optional', () => {
    const result = clientSchema.safeParse({ name: '山田 太郎' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        name: '山田 太郎',
        companyName: null,
        address: null,
        email: null,
        phone: null,
      });
    }
  });

  it('rejects a blank name', () => {
    expect(clientSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('validates optional fields when they are supplied', () => {
    expect(
      clientSchema.safeParse({ name: '山田 太郎', email: 'nope' }).success,
    ).toBe(false);
    expect(
      clientSchema.safeParse({ name: '山田 太郎', phone: 'call-me' }).success,
    ).toBe(false);
  });

  it('lower-cases a supplied email', () => {
    const result = clientSchema.safeParse({ name: '山田 太郎', email: 'Taro@Example.COM' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('taro@example.com');
    }
  });
});
