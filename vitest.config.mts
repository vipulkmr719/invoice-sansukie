import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` is a build-time guard for Next's bundler; it throws when
      // imported outside the react-server condition. Vitest exercises the same
      // server modules directly, so it resolves to a no-op here. The guard
      // still does its job in `next build`, which is where it matters.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globals: false,
    // Database-backed tests share one Postgres schema; keep them serialized.
    fileParallelism: false,
  },
});
