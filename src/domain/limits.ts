/**
 * Shared input limits.
 *
 * These numbers are needed in two places: the Zod schemas that enforce them on
 * the server, and the forms that surface them to the user. They live here —
 * with no dependencies at all — so a client component can read one without
 * pulling the whole validation layer, and Zod with it, into the browser
 * bundle.
 *
 * That is not only a size concern: shipping Zod to the client also brings code
 * that uses `eval`, which forces `'unsafe-eval'` into the Content-Security-
 * Policy. Keeping the schemas server-side is what lets the policy stay strict.
 */

/** Minimum password length, in characters. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

/** Ceilings that keep every derived amount inside a PostgreSQL INTEGER. */
export const MAX_QUANTITY = 1_000_000;
export const MAX_UNIT_PRICE = 100_000_000;
export const MAX_INVOICE_TOTAL = 1_000_000_000;
export const MAX_ITEMS_PER_INVOICE = 100;

/** Decimal places accepted for the two fractional line-item fields. */
export const QUANTITY_DECIMALS = 3;
export const UNIT_PRICE_DECIMALS = 2;

/** Field length caps, mirroring the database columns. */
export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_NAME_LENGTH = 100;
export const MAX_ADDRESS_LENGTH = 300;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_NOTES_LENGTH = 2000;
export const MAX_INVOICE_NUMBER_LENGTH = 32;
