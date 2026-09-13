/**
 * Startup checks.
 *
 * Next.js calls `register()` once when the server boots — at runtime, never
 * during `next build`. That distinction is the whole point of this file.
 *
 * Environment validation itself is lazy (see `lib/env.ts`), because a build
 * evaluates every route module and must not require production secrets. But
 * laziness alone would let a misconfigured deployment start, serve its public
 * pages, and only fail on the first request that touched the database. Reading
 * the environment here restores the property that matters operationally: a
 * deployment with a missing or malformed variable fails loudly, once, at boot —
 * with a message naming the variable — instead of degrading quietly under
 * traffic.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime has the environment; the edge runtime
  // receives a different, narrower set and would report false failures.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { env } = await import('@/lib/env');

  // Touch the variables that must be present for the application to function
  // at all. Reading any one of them validates the whole schema, but naming
  // these two makes the intent obvious to the next reader.
  void env.DATABASE_URL;
  void env.AUTH_SECRET;
}
