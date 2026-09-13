import 'server-only';

import { prisma } from './prisma';

/**
 * Liveness probe for the database.
 *
 * Lives in its own module so that the Prisma client itself is imported only
 * within `src/server/db/` — a rule the data-access audit enforces with no
 * exception list. The health route imports this function, never the client.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  // Parameterless constant query — no user input is involved, and it touches
  // no tenant-owned table, so the tenant guard does not apply.
  await prisma.$queryRaw`SELECT 1`;
  return true;
}
