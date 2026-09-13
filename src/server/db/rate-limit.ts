import 'server-only';

import { prisma } from './prisma';

/**
 * Rate-limit counter persistence.
 *
 * Lives in the repository layer because that is the only place with a Prisma
 * client — the policy (which buckets exist, and how large) lives in
 * `src/server/rate-limit.ts`.
 */

/**
 * Increment the counter for one window and return its new value.
 *
 * A single statement on purpose: two concurrent requests must not both read the
 * same count and both be let through at the boundary.
 */
export async function incrementRateLimitWindow(
  key: string,
  expiresAt: Date,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limits" ("key", "count", "expiresAt")
    VALUES (${key}, 1, ${expiresAt})
    ON CONFLICT ("key")
    DO UPDATE SET "count" = "rate_limits"."count" + 1
    RETURNING "count"
  `;

  return rows[0]?.count ?? 1;
}

/** Delete windows that have expired. */
export async function deleteExpiredRateLimitWindows(now: Date): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return count;
}
