import 'server-only';

import { z } from 'zod';

/**
 * Environment validation (security requirement #6).
 *
 * This module is marked `server-only`: importing it from a `"use client"`
 * module is a build error, which is what keeps `DATABASE_URL` out of every
 * browser bundle (security requirement #4).
 *
 * Validation runs once, on the first property access — not at module
 * evaluation. The distinction matters because `next build` evaluates every
 * route module to collect its config: validating at import time made a
 * production build require a live DATABASE_URL and AUTH_SECRET, which a build
 * has no business needing and which a platform may not expose at build time.
 * The failure was also opaque — a stack trace inside page-data collection
 * rather than a message naming the missing variable.
 *
 * Deferring to first use keeps the "fail loudly on a misconfigured deployment"
 * property exactly where it belongs: the first request that actually needs a
 * value, with the same message it always had.
 */

const DATABASE_URL_PROTOCOLS = ['postgres:', 'postgresql:'] as const;

/**
 * An optional secret that, when present, must have the expected shape.
 *
 * Validating the prefix catches the common deployment mistake of pasting a
 * publishable key where a secret key belongs — which would otherwise fail at
 * the first payment rather than at boot. The value itself is never logged.
 */
function optionalSecret(name: string, pattern: RegExp) {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value))
    .refine((value) => value === undefined || pattern.test(value), {
      message: `${name} does not look like the expected Stripe value`,
    });
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (value) => {
        try {
          return (
            DATABASE_URL_PROTOCOLS as readonly string[]
          ).includes(new URL(value).protocol);
        } catch {
          return false;
        }
      },
      { message: 'DATABASE_URL must be a valid postgresql:// connection string' },
    ),

  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters long'),

  APP_URL: z.url().default('http://localhost:3000'),

  /**
   * Optional path to a Chrome/Chromium binary for PDF rendering. Container
   * images usually install their own; when unset, puppeteer's bundled build is
   * used. Empty string is treated as unset so an empty line in .env does not
   * point the renderer at "".
   */
  PDF_CHROME_PATH: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value)),

  // ---------------------------------------------------------------------------
  // Stripe (all optional; billing simply stays disabled when unset, so the app
  // runs in development and in CI without payment credentials).
  //
  // These are secrets. They are read only here and used only in `src/server`,
  // so they never reach a browser bundle.
  // ---------------------------------------------------------------------------
  STRIPE_SECRET_KEY: optionalSecret('STRIPE_SECRET_KEY', /^sk_(test|live)_/),
  STRIPE_WEBHOOK_SECRET: optionalSecret('STRIPE_WEBHOOK_SECRET', /^whsec_/),
  STRIPE_PRICE_ID_MONTHLY: optionalSecret('STRIPE_PRICE_ID_MONTHLY', /^price_/),
  STRIPE_PRICE_ID_LIFETIME: optionalSecret('STRIPE_PRICE_ID_LIFETIME', /^price_/),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    APP_URL: process.env.APP_URL,
    PDF_CHROME_PATH: process.env.PDF_CHROME_PATH,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_ID_MONTHLY: process.env.STRIPE_PRICE_ID_MONTHLY,
    STRIPE_PRICE_ID_LIFETIME: process.env.STRIPE_PRICE_ID_LIFETIME,
  });

  if (!parsed.success) {
    // Print variable NAMES and the reason, never the offending values —
    // a malformed DATABASE_URL still contains a password.
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration. Fix your .env file (see .env.example):\n${issues}`,
    );
  }

  return parsed.data;
}

let cachedEnv: Env | null = null;

/** Validate once, on demand. Subsequent calls reuse the result. */
function resolveEnv(): Env {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

/**
 * The validated environment.
 *
 * A Proxy rather than a plain object so that reading any variable triggers
 * validation, while merely importing this module does not. Every trap forwards
 * to the resolved object, so spreading, `Object.keys` and `in` behave normally.
 */
export const env: Env = new Proxy({} as Env, {
  get: (_target, property) => resolveEnv()[property as keyof Env],
  has: (_target, property) => property in resolveEnv(),
  ownKeys: () => Reflect.ownKeys(resolveEnv()),
  getOwnPropertyDescriptor: (_target, property) =>
    Reflect.getOwnPropertyDescriptor(resolveEnv(), property),
});

/**
 * NODE_ENV is read straight from `process.env` rather than through the schema.
 * It has a default and cannot fail validation, so deriving these flags costs
 * nothing — and reading them must never be the thing that drags the whole
 * schema into module-evaluation time and reintroduces the build failure.
 */
export const isProduction = process.env.NODE_ENV === 'production';
export const isTest = process.env.NODE_ENV === 'test';

/**
 * Whether payments are configured. Checkout is offered only when true; the
 * rest of the application works either way.
 *
 * A function, not a constant: as a constant it would read four Stripe
 * variables at module scope and validate the entire environment at import.
 */
export function isBillingConfigured(): boolean {
  return (
    env.STRIPE_SECRET_KEY !== undefined &&
    env.STRIPE_WEBHOOK_SECRET !== undefined &&
    (env.STRIPE_PRICE_ID_MONTHLY !== undefined ||
      env.STRIPE_PRICE_ID_LIFETIME !== undefined)
  );
}
