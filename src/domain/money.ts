/**
 * Exact money arithmetic.
 *
 * Japanese invoices are denominated in yen, an integer currency, but line items
 * legitimately carry fractional quantities (1.5 時間) and sub-yen unit prices
 * (¥1,234.56). Multiplying those as IEEE-754 doubles produces results like
 * 0.1 * 3 = 0.30000000000000004, which then rounds the wrong way.
 *
 * Everything here therefore scales decimals to integers and multiplies with
 * BigInt, so the arithmetic is exact for any input the validation layer
 * accepts. Only the final, already-integral yen value is converted back to
 * `number`.
 */

/** Decimal places persisted for `InvoiceItem.quantity` (see schema.prisma). */
export const QUANTITY_SCALE = 3;
/** Decimal places persisted for `InvoiceItem.unitPrice`. */
export const UNIT_PRICE_SCALE = 2;

/**
 * Convert a decimal number to a scaled BigInt, e.g. (12.345, 3) -> 12345n.
 * Throws on non-finite input so a NaN can never silently become 0.
 */
export function toScaledBigInt(value: number, scale: number): bigint {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot scale a non-finite number: ${String(value)}`);
  }

  // Format with a fixed number of decimals first: this both rounds away any
  // representation noise and gives us a pure digit string to parse.
  const fixed = value.toFixed(scale);
  const negative = fixed.startsWith('-');
  const digits = (negative ? fixed.slice(1) : fixed).replace('.', '');
  const scaled = BigInt(digits);

  return negative ? -scaled : scaled;
}

/**
 * Divide two BigInts, rounding half away from zero (四捨五入).
 * `divisor` must be positive.
 */
export function divideRoundHalfUp(dividend: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) {
    throw new RangeError('divisor must be positive');
  }

  const negative = dividend < 0n;
  const absolute = negative ? -dividend : dividend;

  const quotient = absolute / divisor;
  const remainder = absolute % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

/** Divide two BigInts, truncating towards zero (切り捨て). */
export function divideTruncate(dividend: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) {
    throw new RangeError('divisor must be positive');
  }
  return dividend / divisor;
}

/**
 * Tax-exclusive line total in whole yen: `quantity × unitPrice`, rounded half
 * up. The multiplication itself is exact.
 */
export function calculateLineAmount(quantity: number, unitPrice: number): number {
  const scaledQuantity = toScaledBigInt(quantity, QUANTITY_SCALE);
  const scaledUnitPrice = toScaledBigInt(unitPrice, UNIT_PRICE_SCALE);

  const product = scaledQuantity * scaledUnitPrice;
  const divisor = 10n ** BigInt(QUANTITY_SCALE + UNIT_PRICE_SCALE);

  return bigIntToSafeNumber(divideRoundHalfUp(product, divisor));
}

/**
 * Convert a BigInt yen amount to `number`, refusing values that would lose
 * precision or overflow the `INTEGER` columns the amounts are stored in.
 */
export function bigIntToSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('金額が処理可能な範囲を超えています。');
  }
  return Number(value);
}

/** Format an integer yen amount as `¥1,234`. */
export function formatYen(amount: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Format an integer yen amount as `1,234` (no currency symbol). */
export function formatNumber(amount: number): string {
  return new Intl.NumberFormat('ja-JP').format(amount);
}
