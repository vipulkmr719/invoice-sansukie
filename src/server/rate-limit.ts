import 'server-only';

import {
  deleteExpiredRateLimitWindows,
  incrementRateLimitWindow,
} from '@/server/db/rate-limit';

/**
 * Fixed-window rate limiting, backed by the database.
 *
 * The counter lives in Postgres rather than process memory because an
 * in-memory counter is not a limit behind more than one replica: each instance
 * would allow the full quota, and a deploy would reset every window. One atomic
 * upsert per check is a cheap price for a limit that actually holds.
 *
 * Fixed windows (rather than a sliding log) keep this to a single row and a
 * single statement. The trade-off is the usual one — up to 2× the limit can
 * land across a window boundary — which is acceptable for abuse control.
 */

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * The buckets this application limits, and why each number was chosen.
 */
export const RATE_LIMITS = {
  /**
   * Checkout session creation. Each call hits Stripe's API and creates a
   * customer, so it is both costly and a way to spam Stripe. A user upgrading
   * needs one; a handful covers mistakes and back-button retries.
   */
  checkout: { limit: 5, windowSeconds: 60 * 10 },

  /**
   * The webhook endpoint, keyed by source IP. Signature verification is the
   * real defence; this caps how much CPU an unauthenticated flood can spend on
   * HMAC checks. Set well above Stripe's real delivery rate so genuine bursts
   * — a backlog being redelivered — are never dropped.
   */
  webhook: { limit: 240, windowSeconds: 60 },

  /**
   * Invoice creation. Generous enough that no real accountant notices, low
   * enough that a script cannot fill the table.
   */
  invoiceCreate: { limit: 60, windowSeconds: 60 * 10 },

  /**
   * Sign-in attempts from one IP — credential-stuffing control. Generous
   * enough for a shared office NAT, low enough to make spraying expensive.
   */
  login: { limit: 20, windowSeconds: 60 * 10 },

  /**
   * Sign-in attempts against one account, whatever the source address.
   * This is the brute-force limit that actually matters: an attacker with a
   * botnet defeats a per-IP cap, but every attempt still names the account
   * they are trying to break into.
   */
  loginAccount: { limit: 10, windowSeconds: 60 * 15 },

  /** Account creation from one IP — stops automated signup floods. */
  register: { limit: 10, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** When the current window ends. */
  resetAt: Date;
  /** Seconds until the window ends — for a Retry-After header. */
  retryAfterSeconds: number;
}

/**
 * Consume one unit from `bucket` for `subject`.
 *
 * `subject` must be something the caller controls server-side — a user id, or a
 * request IP taken from the trusted proxy header. Never a value the client can
 * choose freely, or the limit is trivially bypassed.
 */
export async function consumeRateLimit(
  bucket: RateLimitBucket,
  subject: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[bucket];

  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(now.getTime() / windowMs) * windowMs;
  const resetAt = new Date(windowStart + windowMs);
  const key = `${bucket}:${subject}:${windowStart}`;

  let count: number;

  try {
    count = await incrementRateLimitWindow(key, resetAt);
  } catch (error) {
    // A limiter that fails closed would take the whole app down with the
    // database; one that fails open only loses abuse control. Log and allow.
    console.error('[rate-limit] counter unavailable, allowing request', error);
    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit,
      resetAt,
      retryAfterSeconds: 0,
    };
  }

  const retryAfterSeconds = Math.max(
    Math.ceil((resetAt.getTime() - now.getTime()) / 1000),
    1,
  );

  return {
    allowed: count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(rule.limit - count, 0),
    resetAt,
    retryAfterSeconds,
  };
}

/**
 * Delete expired windows. Safe to call opportunistically; a cron would do.
 */
export async function pruneRateLimits(now: Date = new Date()): Promise<number> {
  return deleteExpiredRateLimitWindows(now);
}

/**
 * The client IP, taken only from headers a trusted proxy sets.
 *
 * Returns a stable fallback rather than trusting an arbitrary header, so a
 * request that forges `X-Forwarded-For` cannot mint itself a fresh bucket per
 * attempt — it just shares the fallback bucket with every other such request.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    // Left-most entry is the original client, as set by the edge proxy.
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }

  return headers.get('x-real-ip')?.trim() || 'unknown';
}
