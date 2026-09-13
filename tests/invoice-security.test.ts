import { describe, expect, it } from 'vitest';

import { invoiceSchema } from '@/validation/invoice';
import { calculateInvoiceTotals } from '@/domain/tax';

import { XSS_PAYLOADS } from './html-escaping.test';

/**
 * The security suite for invoice creation, one describe-block per required
 * test. Everything here exercises the *server-side* Zod schema — the same code
 * path the server action runs — so nothing depends on browser validation.
 */

const CLIENT_ID = 'clh1234567890abcdefghijk';

function baseInvoice(overrides: Record<string, unknown> = {}) {
  return {
    issuerName: '株式会社インボイス',
    issuerAddress: '東京都渋谷区神宮前2-2-2',
    issuerPhone: '03-5555-0123',
    issuerEmail: 'billing@example.com',
    issuerRegistrationNumber: 'T9234567890123',
    clientId: CLIENT_ID,
    clientName: '株式会社サンプル',
    clientAddress: '東京都千代田区千代田1-1',
    clientEmail: 'taro@example.com',
    invoiceNumber: 'INV-2026-0001',
    issueDate: '2026-09-01',
    dueDate: '2026-09-30',
    notes: '',
    items: [
      { description: 'コンサルティング費', quantity: 1, unitPrice: 100000, taxRate: 10 },
    ],
    ...overrides,
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return { description: '商品', quantity: 1, unitPrice: 1000, taxRate: 10, ...overrides };
}

/** Every error message produced for a field path. */
function messagesFor(
  result: { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } },
  field: string,
): string[] {
  return result.error.issues
    .filter((issue) => issue.path.includes(field))
    .map((issue) => issue.message);
}

// ---------------------------------------------------------------------------
// 1–3. XSS payloads in free-text fields
// ---------------------------------------------------------------------------

describe('1. XSS in client name — 値は保持し、拒否しない', () => {
  it.each(XSS_PAYLOADS)('accepts %o as data and stores it verbatim', (payload) => {
    const result = invoiceSchema.safeParse(baseInvoice({ clientName: payload }));

    // Validation is not the XSS defence: a counterparty may legitimately be
    // called "A < B Ltd". The payload is stored as text and neutralised at the
    // rendering boundary (see tests/pdf-template.test.ts). What matters here is
    // that the value survives unchanged — no silent mangling of user data.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientName).toBe(payload.trim());
    }
  });

  it('still enforces the length limit on a long payload', () => {
    const result = invoiceSchema.safeParse(
      baseInvoice({ clientName: '<script>'.repeat(50) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a client name that is only whitespace', () => {
    const result = invoiceSchema.safeParse(baseInvoice({ clientName: '   ' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messagesFor(result, 'clientName').join()).toMatch(/入力してください/);
    }
  });
});

describe('2. XSS in address — 値は保持し、拒否しない', () => {
  it.each(XSS_PAYLOADS)('accepts %o in the client address', (payload) => {
    const result = invoiceSchema.safeParse(baseInvoice({ clientAddress: payload }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientAddress).toBe(payload.trim());
    }
  });

  it.each(XSS_PAYLOADS)('accepts %o in the issuer address', (payload) => {
    const result = invoiceSchema.safeParse(baseInvoice({ issuerAddress: payload }));
    expect(result.success).toBe(true);
  });

  it('rejects an address longer than the column allows', () => {
    const result = invoiceSchema.safeParse(baseInvoice({ clientAddress: 'あ'.repeat(301) }));
    expect(result.success).toBe(false);
  });
});

describe('3. XSS in item description — 値は保持し、拒否しない', () => {
  it.each(XSS_PAYLOADS)('accepts %o as a description', (payload) => {
    const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ description: payload })] }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0]?.description).toBe(payload.trim());
    }
  });

  it('rejects an empty description', () => {
    const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ description: '' })] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messagesFor(result, 'description').join()).toMatch(/品目を入力/);
    }
  });

  it('rejects a description longer than 200 characters', () => {
    const result = invoiceSchema.safeParse(
      baseInvoice({ items: [item({ description: 'あ'.repeat(201) })] }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Invalid registration number
// ---------------------------------------------------------------------------

describe('4. 登録番号の検証 (invalid registration number)', () => {
  it('accepts T + 13 digits with a correct check digit', () => {
    const result = invoiceSchema.safeParse(
      baseInvoice({ issuerRegistrationNumber: 'T9234567890123' }),
    );
    expect(result.success).toBe(true);
  });

  it.each([
    ['9234567890123', 'missing the T prefix'],
    ['T923456789012', '12 digits — too few'],
    ['T92345678901234', '14 digits — too many'],
    ['T', 'prefix only'],
    ['', 'empty'],
    ['TABCDEFGHIJKLM', 'letters instead of digits'],
    ['T923456789012A', 'a letter inside the number'],
    ['T92345678901 3', 'embedded whitespace'],
    ['T9234567890123 X', 'trailing junk'],
    ['X9234567890123', 'wrong prefix letter'],
    ['T-234567890123', 'a hyphen where a digit belongs'],
    ['T9234567890123<script>', 'markup appended'],
    ["T9234567890123' OR '1'='1", 'SQL-ish suffix'],
    ['T９２３４５６７８９０１２', 'full-width, wrong length'],
  ])('rejects %o (%s)', (registrationNumber) => {
    const result = invoiceSchema.safeParse(baseInvoice({ issuerRegistrationNumber: registrationNumber }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messagesFor(result, 'issuerRegistrationNumber').length).toBeGreaterThan(0);
    }
  });

  it('rejects a well-formed number whose check digit is wrong', () => {
    const result = invoiceSchema.safeParse(
      baseInvoice({ issuerRegistrationNumber: 'T1234567890123' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messagesFor(result, 'issuerRegistrationNumber').join()).toMatch(
        /チェックデジット/,
      );
    }
  });

  it('normalises full-width digits and hyphens before validating', () => {
    const result = invoiceSchema.safeParse(
      baseInvoice({ issuerRegistrationNumber: ' t9234-5678-90123 ' }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issuerRegistrationNumber).toBe('T9234567890123');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Negative quantity
// ---------------------------------------------------------------------------

describe('5. 数量が負 (negative quantity)', () => {
  it.each([-1, -0.001, -100, -999999])('rejects a quantity of %s', (quantity) => {
    const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ quantity })] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messagesFor(result, 'quantity').join()).toMatch(/負の値/);
    }
  });

  it.each(['-1', '-0.5', ' -3 '])('rejects the string %o as a quantity', (quantity) => {
    const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ quantity })] }));
    expect(result.success).toBe(false);
  });

  it('rejects zero — an invoice line must bill something', () => {
    const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ quantity: 0 })] }));
    expect(result.success).toBe(false);
  });

  it('rejects a negative quantity even when another line is valid', () => {
    const result = invoiceSchema.safeParse(
      baseInvoice({ items: [item(), item({ quantity: -5 })] }),
    );
    expect(result.success).toBe(false);
  });

  it('is also rejected by the tax engine, not only by the schema', () => {
    expect(() =>
      calculateInvoiceTotals([{ quantity: -1, unitPrice: 1000, taxRate: 10 }]),
    ).toThrow(/数量に負の値/);
  });
});

// ---------------------------------------------------------------------------
// 6. Negative price
// ---------------------------------------------------------------------------

describe('6. 単価が負 (negative price)', () => {
  it.each([-1, -0.01, -100000])('rejects a unit price of %s', (unitPrice) => {
    const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ unitPrice })] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messagesFor(result, 'unitPrice').join()).toMatch(/負の値/);
    }
  });

  it('accepts zero — a line may legitimately be supplied free of charge', () => {
    const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ unitPrice: 0 })] }));
    expect(result.success).toBe(true);
  });

  it('is also rejected by the tax engine', () => {
    expect(() =>
      calculateInvoiceTotals([{ quantity: 1, unitPrice: -1000, taxRate: 10 }]),
    ).toThrow(/単価に負の値/);
  });
});

// ---------------------------------------------------------------------------
// 7. Invalid tax rate
// ---------------------------------------------------------------------------

describe('7. 税率が不正 (invalid tax rate)', () => {
  it.each([0, 5, 7, 9, 11, 15, 20, 100, -8, -10, 8.5, 9.99])(
    'rejects a tax rate of %s',
    (taxRate) => {
      const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ taxRate })] }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(messagesFor(result, 'taxRate').join()).toMatch(/8%|税率/);
      }
    },
  );

  it.each(['', '  ', 'ten', 'NaN', '<script>', '8; DROP TABLE invoices'])(
    'rejects the non-numeric tax rate %o',
    (taxRate) => {
      const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ taxRate })] }));
      expect(result.success).toBe(false);
    },
  );

  it.each([8, 10, '8', '10'])('accepts the valid tax rate %o', (taxRate) => {
    const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ taxRate })] }));
    expect(result.success).toBe(true);
  });

  it('is also rejected by the tax engine', () => {
    expect(() =>
      calculateInvoiceTotals([{ quantity: 1, unitPrice: 1000, taxRate: 5 }]),
    ).toThrow(/適用できない税率/);
  });
});

// ---------------------------------------------------------------------------
// 8. Extremely large quantity / price
// ---------------------------------------------------------------------------

describe('8. 極端に大きい数量・単価 (extremely large values)', () => {
  it.each([
    1_000_001,
    10_000_000,
    1e9,
    1e15,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_VALUE,
  ])('rejects a quantity of %s', (quantity) => {
    const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ quantity })] }));
    expect(result.success).toBe(false);
  });

  it.each([
    100_000_001,
    1e9,
    1e15,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_VALUE,
  ])('rejects a unit price of %s', (unitPrice) => {
    const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ unitPrice })] }));
    expect(result.success).toBe(false);
  });

  it.each([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN])(
    'rejects the non-finite value %s',
    (value) => {
      expect(
        invoiceSchema.safeParse(baseInvoice({ items: [item({ quantity: value })] })).success,
      ).toBe(false);
      expect(
        invoiceSchema.safeParse(baseInvoice({ items: [item({ unitPrice: value })] })).success,
      ).toBe(false);
    },
  );

  it.each(['1e309', '9'.repeat(400), '0x7fffffff', '1_000_000'])(
    'rejects the overflow-shaped string %o',
    (quantity) => {
      const result = invoiceSchema.safeParse(baseInvoice({ items: [item({ quantity })] }));
      expect(result.success).toBe(false);
    },
  );

  it('rejects an invoice with more line items than the limit', () => {
    const result = invoiceSchema.safeParse(
      baseInvoice({ items: Array.from({ length: 101 }, () => item()) }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts the largest values that are still in range, and totals them exactly', () => {
    const result = invoiceSchema.safeParse(
      baseInvoice({ items: [item({ quantity: 1_000_000, unitPrice: 1_000 })] }),
    );
    expect(result.success).toBe(true);

    // 1,000,000 × ¥1,000 = ¥1,000,000,000 — computed with BigInt, no drift.
    const totals = calculateInvoiceTotals([
      { quantity: 1_000_000, unitPrice: 1_000, taxRate: 10 },
    ]);
    expect(totals.subtotal).toBe(1_000_000_000);
    expect(totals.tax10).toBe(100_000_000);
    expect(totals.total).toBe(1_100_000_000);
  });
});

// ---------------------------------------------------------------------------
// 9. Missing required fields
// ---------------------------------------------------------------------------

describe('9. 必須項目の欠落 (missing required fields)', () => {
  const REQUIRED_FIELDS = [
    'issuerName',
    'issuerAddress',
    'issuerPhone',
    'issuerEmail',
    'issuerRegistrationNumber',
    'clientId',
    'clientName',
    'invoiceNumber',
    'issueDate',
    'dueDate',
    'items',
  ] as const;

  it.each(REQUIRED_FIELDS)('rejects an invoice with %s absent', (field) => {
    const payload = baseInvoice();
    delete (payload as Record<string, unknown>)[field];

    const result = invoiceSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it.each(REQUIRED_FIELDS)('rejects an invoice with %s set to null', (field) => {
    const result = invoiceSchema.safeParse(baseInvoice({ [field]: null }));
    expect(result.success).toBe(false);
  });

  it.each([
    'issuerName',
    'issuerAddress',
    'issuerPhone',
    'clientName',
    'invoiceNumber',
  ])('rejects an invoice whose %s is only whitespace', (field) => {
    const result = invoiceSchema.safeParse(baseInvoice({ [field]: '   ' }));
    expect(result.success).toBe(false);
  });

  it('rejects an invoice with no line items', () => {
    const result = invoiceSchema.safeParse(baseInvoice({ items: [] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messagesFor(result, 'items').join()).toMatch(/1件以上/);
    }
  });

  it('rejects an entirely empty payload', () => {
    expect(invoiceSchema.safeParse({}).success).toBe(false);
    expect(invoiceSchema.safeParse(null).success).toBe(false);
    expect(invoiceSchema.safeParse(undefined).success).toBe(false);
    expect(invoiceSchema.safeParse('not an object').success).toBe(false);
  });

  it('treats optional fields as genuinely optional', () => {
    const payload = baseInvoice();
    delete (payload as Record<string, unknown>).notes;
    delete (payload as Record<string, unknown>).clientAddress;
    delete (payload as Record<string, unknown>).clientEmail;

    const result = invoiceSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBeNull();
      expect(result.data.clientAddress).toBeNull();
      expect(result.data.clientEmail).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Dates and identifiers
// ---------------------------------------------------------------------------

describe('日付と識別子の検証', () => {
  it.each([
    '2026/09/01',
    '01-09-2026',
    '2026-9-1',
    'yesterday',
    '2026-13-01',
    '2026-02-30',
    '<script>',
  ])('rejects the invalid issue date %o', (issueDate) => {
    expect(invoiceSchema.safeParse(baseInvoice({ issueDate })).success).toBe(false);
  });

  it('rejects a due date earlier than the issue date', () => {
    const result = invoiceSchema.safeParse(
      baseInvoice({ issueDate: '2026-09-30', dueDate: '2026-09-01' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messagesFor(result, 'dueDate').join()).toMatch(/発行日以降/);
    }
  });

  it.each([
    "'; DROP TABLE invoices; --",
    '../../etc/passwd',
    '<script>alert(1)</script>',
    'a'.repeat(65),
  ])('rejects the malformed client id %o', (clientId) => {
    expect(invoiceSchema.safeParse(baseInvoice({ clientId })).success).toBe(false);
  });

  it.each(['INV 2026 0001', '<script>', 'INV/2026', 'AB', 'x'.repeat(33)])(
    'rejects the malformed invoice number %o',
    (invoiceNumber) => {
      expect(invoiceSchema.safeParse(baseInvoice({ invoiceNumber })).success).toBe(false);
    },
  );
});
