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

export const prisma: ExtendedPrismaClient =
  globalForPrisma.prisma ?? createPrismaClient();

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
