import { describe, expect, it } from 'vitest';

import {
  calculateCheckDigit,
  formatRegistrationNumber,
  hasRegistrationNumberFormat,
  hasValidCheckDigit,
  normalizeRegistrationNumber,
  validateRegistrationNumber,
} from '@/domain/registration-number';

/**
 * `T9234567890123` — base number 234567890123, whose National Tax Agency check
 * digit works out to 9. Used throughout as the known-good value.
 */
const VALID = 'T9234567890123';

describe('calculateCheckDigit', () => {
  it('matches the National Tax Agency algorithm', () => {
    // 180301018771 -> 1, i.e. the corporate number 1180301018771.
    expect(calculateCheckDigit('180301018771')).toBe(1);
    expect(calculateCheckDigit('234567890123')).toBe(9);
  });

  it('requires exactly 12 digits', () => {
    expect(() => calculateCheckDigit('12345678901')).toThrow(RangeError);
    expect(() => calculateCheckDigit('1234567890123')).toThrow(RangeError);
    expect(() => calculateCheckDigit('12345678901a')).toThrow(RangeError);
  });
});

describe('登録番号の形式 (format)', () => {
  it('accepts T + 13 digits', () => {
    expect(hasRegistrationNumberFormat(VALID)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['1234567890123', 'missing the T prefix'],
    ['T123456789012', '12 digits'],
    ['T12345678901234', '14 digits'],
    ['X1234567890123', 'wrong prefix letter'],
    ['T123456789012A', 'a letter among the digits'],
    ['T 1234567890123', 'an embedded space'],
    ['t1234567890123', 'a lower-case prefix'],
  ])('rejects %o (%s)', (value) => {
    expect(hasRegistrationNumberFormat(value)).toBe(false);
  });
});

describe('チェックデジット (check digit)', () => {
  it('accepts a number whose check digit agrees', () => {
    expect(hasValidCheckDigit(VALID)).toBe(true);
    expect(hasValidCheckDigit('T1180301018771')).toBe(true);
  });

  it('rejects a well-formed number with the wrong check digit', () => {
    // Same base number, every other leading digit is wrong.
    for (const wrong of ['0', '1', '2', '3', '4', '5', '6', '7', '8']) {
      expect(hasValidCheckDigit(`T${wrong}234567890123`)).toBe(false);
    }
  });
});

describe('normalizeRegistrationNumber', () => {
  it('folds full-width characters, strips hyphens and upper-cases', () => {
    expect(normalizeRegistrationNumber('　t9234-5678-90123 '.trim())).toBe(VALID);
    expect(normalizeRegistrationNumber('Ｔ９２３４５６７８９０１２３')).toBe(VALID);
  });
});

describe('validateRegistrationNumber', () => {
  it('normalises and accepts a valid number', () => {
    const result = validateRegistrationNumber(' t9234-5678-90123 ');
    expect(result).toEqual({ valid: true, value: VALID });
  });

  it('reports a format problem separately from a check-digit problem', () => {
    const badFormat = validateRegistrationNumber('12345');
    expect(badFormat.valid).toBe(false);
    expect(badFormat.valid === false && badFormat.message).toMatch(/形式/);

    const badCheckDigit = validateRegistrationNumber('T1234567890123');
    expect(badCheckDigit.valid).toBe(false);
    expect(
      badCheckDigit.valid === false && badCheckDigit.message,
    ).toMatch(/チェックデジット/);
  });
});

describe('formatRegistrationNumber', () => {
  it('groups the digits for display', () => {
    expect(formatRegistrationNumber(VALID)).toBe('T9234-5678-90123');
  });

  it('leaves a malformed value untouched', () => {
    expect(formatRegistrationNumber('not-a-number')).toBe('not-a-number');
  });
});
