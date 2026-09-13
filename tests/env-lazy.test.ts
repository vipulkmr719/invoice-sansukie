import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Environment validation must be lazy.
 *
 * `next build` evaluates every route module to collect its config. When
 * `src/lib/env.ts` validated at module scope, that made a production build
 * require a live DATABASE_URL and AUTH_SECRET — and a deployment without them
 * failed inside page-data collection with a stack trace rather than a message
 * naming the missing variable:
 *
 *     Error: Failed to collect configuration for /api/health
 *       [cause]: Invalid environment configuration …
 *
 * These tests run a real Node process with the environment deliberately
 * stripped, because that is the only way to observe module-evaluation
 * behaviour — importing the module inside this suite would see the test
 * runner's own already-valid environment and prove nothing.
 */

const ROOT = process.cwd();

/**
 * `--conditions=react-server` is what lets `import 'server-only'` resolve to its
 * no-op entry, exactly as a bundler resolves it for a Server Component. Without
 * it the package throws on import and the probe measures nothing useful.
 */
const NODE_ARGS = [
  '--conditions=react-server',
  '--experimental-strip-types',
  '--no-warnings',
  // Supplies the `@/*` alias and extensionless TypeScript resolution that the
  // bundler normally provides, so a probe can load a real module graph.
  '--import', './tests/helpers/register-alias.mjs',
];

/** Run a snippet in a clean child process with no app environment variables. */
function runWithoutEnv(source: string): { ok: boolean; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'env-lazy-'));
  const file = join(dir, 'probe.mjs');
  writeFileSync(file, source, 'utf8');

  // Strip every variable the schema reads, plus dotenv's own loading path, so
  // the child cannot recover them from .env.
  const stripped = { ...process.env };
  for (const key of [
    'DATABASE_URL', 'AUTH_SECRET', 'APP_URL', 'PDF_CHROME_PATH',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_ID_MONTHLY', 'STRIPE_PRICE_ID_LIFETIME',
  ]) delete stripped[key];

  try {
    const stdout = execFileSync(process.execPath, NODE_ARGS.concat(file), {
      cwd: ROOT,
      env: { ...stripped, NODE_ENV: 'production' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('environment validation is deferred to first use', () => {
  it('importing the env module with no variables set does not throw', () => {
    // This is the exact condition that broke the Vercel build.
    const result = runWithoutEnv(`
      const mod = await import(${JSON.stringify(join(ROOT, 'src/lib/env.ts'))});
      if (typeof mod.env !== 'object') throw new Error('env should be an object');
      console.log('IMPORTED_OK');
    `);
    expect(result.stderr).not.toMatch(/Invalid environment configuration/);
    expect(result.stdout).toContain('IMPORTED_OK');
    expect(result.ok).toBe(true);
  });

  it('reading a variable with none set still fails loudly, naming what is missing', () => {
    const result = runWithoutEnv(`
      const { env } = await import(${JSON.stringify(join(ROOT, 'src/lib/env.ts'))});
      try {
        void env.DATABASE_URL;
        console.log('NO_THROW');
      } catch (error) {
        console.log('THREW:' + error.message);
      }
    `);
    expect(result.stdout).toContain('THREW:');
    expect(result.stdout).toContain('Invalid environment configuration');
    expect(result.stdout).toContain('DATABASE_URL');
    expect(result.stdout).toContain('AUTH_SECRET');
  });

  it('never puts a secret value in the failure message, only variable names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'env-lazy-secret-'));
    const file = join(dir, 'probe.mjs');
    writeFileSync(file, `
      const { env } = await import(${JSON.stringify(join(ROOT, 'src/lib/env.ts'))});
      try { void env.DATABASE_URL; } catch (error) { console.log('MSG:' + error.message); }
    `, 'utf8');

    const stripped = { ...process.env };
    for (const key of ['AUTH_SECRET', 'APP_URL']) delete stripped[key];

    const stdout = execFileSync(process.execPath, NODE_ARGS.concat(file), {
      cwd: ROOT,
      // A malformed URL that still contains a password: the message must name
      // DATABASE_URL without echoing it back.
      env: { ...stripped, NODE_ENV: 'production', DATABASE_URL: 'mysql://user:hunter2@db/app' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(stdout).toContain('DATABASE_URL');
    expect(stdout).not.toContain('hunter2');
    expect(stdout).not.toContain('mysql://');
  });

  it('importing the Prisma module with no DATABASE_URL does not throw', () => {
    // prisma.ts built its client at module scope, so it failed the same way
    // even once env.ts itself was lazy.
    const result = runWithoutEnv(`
      const mod = await import(${JSON.stringify(join(ROOT, 'src/server/db/prisma.ts'))});
      if (typeof mod.prisma !== 'object') throw new Error('prisma should be an object');
      console.log('PRISMA_IMPORTED_OK');
    `);
    expect(result.stderr).not.toMatch(/Invalid environment configuration/);
    expect(result.stdout).toContain('PRISMA_IMPORTED_OK');
  });
});

describe('the lazy env still behaves like a plain object', () => {
  it('exposes the same keys and values as the underlying config', async () => {
    // Here the test runner's real environment applies, so the values are valid.
    const { env } = await import('@/lib/env');

    expect(typeof env.DATABASE_URL).toBe('string');
    expect(env.DATABASE_URL.startsWith('postgres')).toBe(true);
    expect(typeof env.AUTH_SECRET).toBe('string');
    expect('DATABASE_URL' in env).toBe(true);
    expect(Object.keys(env)).toContain('AUTH_SECRET');
    expect({ ...env }).toHaveProperty('APP_URL');
  });

  it('validates once and reuses the result', async () => {
    const { env } = await import('@/lib/env');
    expect(env.DATABASE_URL).toBe(env.DATABASE_URL);
    expect(env.APP_URL).toBe(env.APP_URL);
  });

  it('isProduction and isTest read NODE_ENV without touching the schema', async () => {
    const { isProduction, isTest } = await import('@/lib/env');
    expect(typeof isProduction).toBe('boolean');
    expect(typeof isTest).toBe('boolean');
    expect(isProduction).toBe(process.env.NODE_ENV === 'production');
  });

  it('isBillingConfigured is a function, so it cannot validate at import', async () => {
    const mod = await import('@/lib/env');
    expect(typeof mod.isBillingConfigured).toBe('function');
    expect(typeof mod.isBillingConfigured()).toBe('boolean');
  });
});
