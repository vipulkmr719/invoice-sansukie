import { describe, expect, it } from 'vitest';

import {
  calculateLineAmount,
  divideRoundHalfUp,
  divideTruncate,
  formatYen,
  toScaledBigInt,
} from '@/domain/money';

describe('toScaledBigInt', () => {
  it('scales decimals to exact integers', () => {
    expect(toScaledBigInt(12.345, 3)).toBe(12345n);
    expect(toScaledBigInt(0.1, 2)).toBe(10n);
    expect(toScaledBigInt(-5.5, 2)).toBe(-550n);
    expect(toScaledBigInt(1000, 0)).toBe(1000n);
  });

  it('rejects non-finite values instead of silently producing 0', () => {
    expect(() => toScaledBigInt(Number.NaN, 2)).toThrow(RangeError);
    expect(() => toScaledBigInt(Number.POSITIVE_INFINITY, 2)).toThrow(RangeError);
  });
});

describe('rounding helpers', () => {
  it('rounds half away from zero', () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divideRoundHalfUp(1n, 3n)).toBe(0n);
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
  });

  it('truncates towards zero', () => {
    expect(divideTruncate(199n, 100n)).toBe(1n);
    expect(divideTruncate(99n, 100n)).toBe(0n);
  });

  it('refuses a non-positive divisor', () => {
    expect(() => divideRoundHalfUp(1n, 0n)).toThrow(RangeError);
    expect(() => divideTruncate(1n, -1n)).toThrow(RangeError);
  });
});

describe('calculateLineAmount', () => {
  it('multiplies quantity by unit price', () => {
    expect(calculateLineAmount(3, 1000)).toBe(3000);
    expect(calculateLineAmount(1, 0)).toBe(0);
  });

  it('handles fractional quantities and sub-yen prices exactly', () => {
    expect(calculateLineAmount(1.5, 2000)).toBe(3000);
    expect(calculateLineAmount(2, 1234.56)).toBe(2469); // 2469.12 -> 2469
    expect(calculateLineAmount(0.25, 100)).toBe(25);
  });

  it('is immune to binary floating point error', () => {
    // 0.1 * 3 is 0.30000000000000004 as a double; scaled integers are exact.
    expect(calculateLineAmount(0.3, 1_000_000)).toBe(300_000);
    expect(calculateLineAmount(3, 0.1)).toBe(0); // 0.3 yen rounds down to 0
    expect(calculateLineAmount(7, 0.1)).toBe(1); // 0.7 yen rounds up to 1
  });

  it('rounds the line total half away from zero', () => {
    expect(calculateLineAmount(1, 0.5)).toBe(1);
    expect(calculateLineAmount(1, 0.49)).toBe(0);
  });
});

describe('formatYen', () => {
  it('formats integer yen in Japanese locale', () => {
    expect(formatYen(1234)).toContain('1,234');
    expect(formatYen(0)).toContain('0');
  });
});
