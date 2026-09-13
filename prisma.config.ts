import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (Prisma 7).
 *
 * The connection string is read from the environment at CLI time only —
 * `prisma migrate`, `prisma studio` and friends. Application code never reads
 * `process.env.DATABASE_URL` directly; it goes through `src/lib/env.ts`, which
 * validates it first, and connects via the driver adapter in
 * `src/server/db/prisma.ts`.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
