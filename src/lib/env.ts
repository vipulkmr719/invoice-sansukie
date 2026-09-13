import 'server-only';

import { z } from 'zod';

/**
 * Environment validation (security requirement #6).
 *
 * This module is marked `server-only`: importing it from a `"use client"`
 * module is a build error, which is what keeps `DATABASE_URL` out of every
 * browser bundle (security requirement #4).
 *
 * Validation runs once, at module evaluation time, so a misconfigured
 * deployment fails immediately and loudly at startup rather than at the first
 * request that happens to touch the database.
 */

const DATABASE_URL_PROTOCOLS = ['postgres:', 'postgresql:'] as const;

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
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    APP_URL: process.env.APP_URL,
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

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
