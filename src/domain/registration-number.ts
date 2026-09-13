/**
 * 適格請求書発行事業者登録番号 (qualified invoice issuer registration number).
 *
 * Format: "T" followed by a 13-digit number. For a corporation those 13 digits
 * are its 法人番号 (corporate number); sole proprietors receive a 13-digit
 * number issued on the same scheme. In both cases the leading digit is a check
 * digit over the remaining twelve, defined by the National Tax Agency as:
 *
 *   check = 9 − ( Σ(n=1..12) Pn × Qn ) mod 9
 *
 * where Pn is the n-th digit of the 12-digit base number counted from the
 * right, and Qn is 1 for odd n and 2 for even n.
 */

const REGISTRATION_NUMBER_PATTERN = /^T\d{13}$/;

export const REGISTRATION_NUMBER_FORMAT_MESSAGE =
  '登録番号は「T」+ 数字13桁の形式で入力してください（例: T1234567890123）。';

export const REGISTRATION_NUMBER_CHECK_DIGIT_MESSAGE =
  '登録番号のチェックデジットが正しくありません。番号をご確認ください。';

/** True when the value is "T" + exactly 13 digits. */
export function hasRegistrationNumberFormat(value: string): boolean {
  return REGISTRATION_NUMBER_PATTERN.test(value);
}

/**
 * Compute the National Tax Agency check digit for a 12-digit base number.
 * Returns a digit in 1..9.
 */
export function calculateCheckDigit(baseNumber: string): number {
  if (!/^\d{12}$/.test(baseNumber)) {
    throw new RangeError('基礎番号は数字12桁で指定してください。');
  }

  let sum = 0;
  for (let n = 1; n <= 12; n += 1) {
    // P1 is the rightmost digit of the base number.
    const digit = Number(baseNumber[baseNumber.length - n]);
    const weight = n % 2 === 1 ? 1 : 2;
    sum += digit * weight;
  }

  return 9 - (sum % 9);
}

/** True when the check digit of a well-formed registration number agrees. */
export function hasValidCheckDigit(value: string): boolean {
  if (!hasRegistrationNumberFormat(value)) {
    return false;
  }

  const digits = value.slice(1);
  const checkDigit = Number(digits[0]);
  const baseNumber = digits.slice(1);

  return calculateCheckDigit(baseNumber) === checkDigit;
}

/**
 * Normalise user input before validation: trim, upper-case the "T", and fold
 * full-width characters (Ｔ１２３…) — Japanese keyboards produce these easily.
 */
export function normalizeRegistrationNumber(value: string): string {
  return value
    .trim()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/[\s-]/g, '')
    .toUpperCase();
}

export type RegistrationNumberValidation =
  | { valid: true; value: string }
  | { valid: false; message: string };

/** Normalise and fully validate a registration number. */
export function validateRegistrationNumber(
  input: string,
): RegistrationNumberValidation {
  const value = normalizeRegistrationNumber(input);

  if (!hasRegistrationNumberFormat(value)) {
    return { valid: false, message: REGISTRATION_NUMBER_FORMAT_MESSAGE };
  }

  if (!hasValidCheckDigit(value)) {
    return { valid: false, message: REGISTRATION_NUMBER_CHECK_DIGIT_MESSAGE };
  }

  return { valid: true, value };
}

/** Display form: `T1234567890123` → `T1234-5678-90123`-style grouping. */
export function formatRegistrationNumber(value: string): string {
  if (!hasRegistrationNumberFormat(value)) {
    return value;
  }
  const digits = value.slice(1);
  return `T${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`;
}
