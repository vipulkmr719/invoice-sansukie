import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';

import { env, isProduction } from '@/lib/env';
import { PrismaClient } from '@/generated/prisma/client';

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

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log: isProduction ? ['error'] : ['warn', 'error'],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}

/** Liveness probe used by the health route and the connection test. */
export async function checkDatabaseConnection(): Promise<boolean> {
  // Parameterless constant query — no user input is involved anywhere here.
  await prisma.$queryRaw`SELECT 1`;
  return true;
}
