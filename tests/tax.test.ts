import { describe, expect, it } from 'vitest';

import {
  TAX_RATE_REDUCED,
  TAX_RATE_STANDARD,
  calculateInvoiceTotals,
  calculateTaxForRate,
  isValidTaxRate,
} from '@/domain/tax';

describe('税率の検証 (invalid tax rate)', () => {
  it('accepts only 8% and 10%', () => {
    expect(isValidTaxRate(8)).toBe(true);
    expect(isValidTaxRate(10)).toBe(true);
  });

  it.each([0, 5, 7, 9, 11, 20, 100, -8, 8.5])(
    'rejects %s%% as a tax rate',
    (rate) => {
      expect(isValidTaxRate(rate)).toBe(false);
      expect(() => calculateTaxForRate(1000, rate)).toThrow(RangeError);
    },
  );

  it('rejects an invalid rate on a line item', () => {
    expect(() =>
      calculateInvoiceTotals([{ quantity: 1, unitPrice: 1000, taxRate: 5 }]),
    ).toThrow(/適用できない税率/);
  });
});

describe('calculateTaxForRate', () => {
  it('computes 10% consumption tax', () => {
    expect(calculateTaxForRate(10_000, TAX_RATE_STANDARD)).toBe(1000);
  });

  it('computes 8% reduced-rate consumption tax', () => {
    expect(calculateTaxForRate(10_000, TAX_RATE_REDUCED)).toBe(800);
  });

  it('truncates fractional yen (切り捨て)', () => {
    // 1,111 * 10% = 111.1 -> 111
    expect(calculateTaxForRate(1_111, TAX_RATE_STANDARD)).toBe(111);
    // 1,111 * 8% = 88.88 -> 88
    expect(calculateTaxForRate(1_111, TAX_RATE_REDUCED)).toBe(88);
  });

  it('rejects a negative or non-integer taxable base', () => {
    expect(() => calculateTaxForRate(-1, TAX_RATE_STANDARD)).toThrow(RangeError);
    expect(() => calculateTaxForRate(100.5, TAX_RATE_STANDARD)).toThrow(RangeError);
  });
});

describe('calculateInvoiceTotals', () => {
  it('rounds tax once per rate group, not per line', () => {
    // Three lines at 1,111 yen. Per line: 111.1 -> 111 each = 333.
    // Per group (the invoice system requires this): 3,333 * 10% = 333.3 -> 333.
    const totals = calculateInvoiceTotals([
      { quantity: 1, unitPrice: 1111, taxRate: 10 },
      { quantity: 1, unitPrice: 1111, taxRate: 10 },
      { quantity: 1, unitPrice: 1111, taxRate: 10 },
    ]);

    expect(totals.subtotal10).toBe(3333);
    expect(totals.tax10).toBe(333);
  });

  it('separates 8% and 10% groups and sums them into the total', () => {
    const totals = calculateInvoiceTotals([
      { quantity: 2, unitPrice: 1500, taxRate: 10 }, // 3,000
      { quantity: 1, unitPrice: 2000, taxRate: 8 }, //  2,000
      { quantity: 3, unitPrice: 500, taxRate: 8 }, //   1,500
    ]);

    expect(totals.subtotal10).toBe(3000);
    expect(totals.subtotal8).toBe(3500);
    expect(totals.subtotal).toBe(6500);
    expect(totals.tax10).toBe(300);
    expect(totals.tax8).toBe(280);
    expect(totals.total).toBe(7080);
    expect(totals.total).toBe(totals.subtotal + totals.tax8 + totals.tax10);
  });

  it('returns per-line amounts in input order', () => {
    const totals = calculateInvoiceTotals([
      { quantity: 2, unitPrice: 100, taxRate: 10 },
      { quantity: 3, unitPrice: 200, taxRate: 8 },
    ]);

    expect(totals.lineAmounts).toEqual([200, 600]);
  });

  it('handles an invoice with no lines', () => {
    const totals = calculateInvoiceTotals([]);

    expect(totals.subtotal).toBe(0);
    expect(totals.tax8).toBe(0);
    expect(totals.tax10).toBe(0);
    expect(totals.total).toBe(0);
  });

  it('rejects a negative quantity', () => {
    expect(() =>
      calculateInvoiceTotals([{ quantity: -1, unitPrice: 1000, taxRate: 10 }]),
    ).toThrow(/数量に負の値/);
  });

  it('rejects a negative unit price', () => {
    expect(() =>
      calculateInvoiceTotals([{ quantity: 1, unitPrice: -1000, taxRate: 10 }]),
    ).toThrow(/単価に負の値/);
  });
});
