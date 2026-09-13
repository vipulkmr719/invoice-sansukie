import {
  bigIntToSafeNumber,
  calculateLineAmount,
  divideTruncate,
  toScaledBigInt,
} from './money';

/**
 * 消費税の計算 (Japanese consumption tax).
 *
 * Under the 適格請求書等保存方式 (invoice system, in force since 2023-10-01) a
 * qualified invoice must state, per tax rate, the tax-exclusive total and the
 * tax due on it — and the tax may be rounded only *once per rate*, not per
 * line. That is exactly what `calculateInvoiceTotals` does: it groups lines by
 * rate, sums each group, then rounds each group's tax a single time.
 *
 * Rounding direction per rate group is 切り捨て (truncate), the most common
 * convention and the one that never over-charges the counterparty.
 */

/** 標準税率 */
export const TAX_RATE_STANDARD = 10;
/** 軽減税率 */
export const TAX_RATE_REDUCED = 8;

export const VALID_TAX_RATES = [TAX_RATE_REDUCED, TAX_RATE_STANDARD] as const;

export type TaxRate = (typeof VALID_TAX_RATES)[number];

export function isValidTaxRate(rate: number): rate is TaxRate {
  return (VALID_TAX_RATES as readonly number[]).includes(rate);
}

export function taxRateLabel(rate: number): string {
  if (rate === TAX_RATE_REDUCED) return '8%（軽減）';
  if (rate === TAX_RATE_STANDARD) return '10%';
  return `${rate}%`;
}

export interface TaxableLine {
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export interface LineAmount {
  /** Tax-exclusive line total, whole yen. */
  amount: number;
}

export interface InvoiceTotals {
  /** 税抜合計 */
  subtotal: number;
  /** 8% 対象の税抜合計 */
  subtotal8: number;
  /** 10% 対象の税抜合計 */
  subtotal10: number;
  /** 8% 分の消費税額 */
  tax8: number;
  /** 10% 分の消費税額 */
  tax10: number;
  /** 税込合計 */
  total: number;
  /** Per-line tax-exclusive amounts, in input order. */
  lineAmounts: number[];
}

/**
 * Consumption tax for one rate group, truncated to whole yen.
 * `subtotal` is the tax-exclusive total of every line at `rate`.
 */
export function calculateTaxForRate(subtotal: number, rate: number): number {
  if (!isValidTaxRate(rate)) {
    throw new RangeError(
      `適用できない税率です: ${String(rate)}%（8% または 10% のみ）`,
    );
  }
  if (!Number.isInteger(subtotal)) {
    throw new RangeError('税抜金額は整数（円）で指定してください。');
  }
  if (subtotal < 0) {
    throw new RangeError('税抜金額に負の値は指定できません。');
  }

  const scaled = toScaledBigInt(subtotal, 0) * BigInt(rate);
  return bigIntToSafeNumber(divideTruncate(scaled, 100n));
}

/**
 * Compute every monetary figure on an invoice from its raw lines.
 *
 * This is the single source of truth for invoice money: the UI calls it to
 * preview totals and the server action calls it again before writing, so a
 * tampered client payload can never decide what gets stored.
 */
export function calculateInvoiceTotals(lines: readonly TaxableLine[]): InvoiceTotals {
  const lineAmounts: number[] = [];

  let subtotal8 = 0;
  let subtotal10 = 0;

  for (const line of lines) {
    if (!isValidTaxRate(line.taxRate)) {
      throw new RangeError(
        `適用できない税率です: ${String(line.taxRate)}%（8% または 10% のみ）`,
      );
    }
    if (line.quantity < 0) {
      throw new RangeError('数量に負の値は指定できません。');
    }
    if (line.unitPrice < 0) {
      throw new RangeError('単価に負の値は指定できません。');
    }

    const amount = calculateLineAmount(line.quantity, line.unitPrice);
    lineAmounts.push(amount);

    if (line.taxRate === TAX_RATE_REDUCED) {
      subtotal8 += amount;
    } else {
      subtotal10 += amount;
    }
  }

  const tax8 = calculateTaxForRate(subtotal8, TAX_RATE_REDUCED);
  const tax10 = calculateTaxForRate(subtotal10, TAX_RATE_STANDARD);
  const subtotal = subtotal8 + subtotal10;

  return {
    subtotal,
    subtotal8,
    subtotal10,
    tax8,
    tax10,
    total: subtotal + tax8 + tax10,
    lineAmounts,
  };
}
