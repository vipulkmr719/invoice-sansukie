import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';

import { env, isProduction } from '@/lib/env';
import { PrismaClient } from '@/generated/prisma/client';

import { tenantGuardExtension } from './tenant-guard';

/**
 * The single Prisma client for the process.
 *
 * `server-only` above is the guard that makes security requirement #4
 * mechanical rather than a convention: any `"use client"` module that
 * (transitively) imports this file fails the build, so `DATABASE_URL` can never
 * end up in a browser bundle.
 *
 * In development Next.js re-evaluates modules on every hot reload, which would
 * otherwise open a new connection pool each time until Postgres refuses them —
 * hence the globalThis cache.
 *
 * The client is created on first use, not at module evaluation. `next build`
 * evaluates every route module to collect its config; building the client
 * eagerly meant a production build had to hold a real DATABASE_URL, and failed
 * inside page-data collection when it did not. Nothing opens a connection until
 * a query is actually issued.
 */

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  const client = new PrismaClient({
    adapter,
    log: isProduction ? ['error'] : ['warn', 'error'],
  });

  // Tenant-scope guard: refuses any query on Client / Invoice / InvoiceItem /
  // Company that is not scoped to the owning user. See ./tenant-guard.ts.
  return client.$extends(tenantGuardExtension());
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

let productionClient: ExtendedPrismaClient | undefined;

function resolveClient(): ExtendedPrismaClient {
  if (isProduction) {
    // One instance per process. Nothing is stashed on globalThis, because a
    // production process is never hot-reloaded.
    productionClient ??= createPrismaClient();
    return productionClient;
  }

  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}

/**
 * The Prisma client, resolved on first property access.
 *
 * Functions are bound to the real client so `prisma.$transaction(...)` and
 * every model method keep their `this`.
 */
export const prisma: ExtendedPrismaClient = new Proxy({} as ExtendedPrismaClient, {
  get: (_target, property) => {
    const client = resolveClient();
    const value = Reflect.get(client, property) as unknown;
    return typeof value === 'function' ? value.bind(client) : value;
  },
  has: (_target, property) => property in resolveClient(),
});
