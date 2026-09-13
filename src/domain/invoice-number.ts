/**
 * 請求書番号の生成.
 *
 * Numbers look like `INV-2026-0001`: a fixed prefix, the issue year, and a
 * zero-padded sequence that restarts each year. `Invoice.invoiceNumber` is
 * unique per user, so the sequence only has to be unique within one account.
 */

export const INVOICE_NUMBER_PREFIX = 'INV';
const SEQUENCE_DIGITS = 4;

export const INVOICE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/;

export function buildInvoiceNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError('請求書番号の年が不正です。');
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('請求書番号の連番が不正です。');
  }

  return `${INVOICE_NUMBER_PREFIX}-${year}-${String(sequence).padStart(SEQUENCE_DIGITS, '0')}`;
}

/**
 * Given the numbers already issued in `year`, return the next one.
 * Any existing number that does not match the generated shape is ignored, so
 * users who type their own numbers never break the sequence.
 */
export function nextInvoiceNumber(
  year: number,
  existingNumbers: readonly string[],
): string {
  const prefix = `${INVOICE_NUMBER_PREFIX}-${year}-`;

  let highest = 0;
  for (const existing of existingNumbers) {
    if (!existing.startsWith(prefix)) continue;

    const tail = existing.slice(prefix.length);
    if (!/^\d+$/.test(tail)) continue;

    const sequence = Number.parseInt(tail, 10);
    if (sequence > highest) highest = sequence;
  }

  return buildInvoiceNumber(year, highest + 1);
}
