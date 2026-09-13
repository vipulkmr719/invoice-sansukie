/**
 * Test bootstrap.
 *
 * Loads .env so DATABASE_URL and AUTH_SECRET are present, exactly as they are
 * at runtime. Nothing here hardcodes a connection string or a secret — a test
 * run uses the same validated environment the app does.
 */
import { config } from 'dotenv';

config({ path: '.env', quiet: true });

// `NODE_ENV` is declared read-only by @types/node. Vitest already sets it to
// 'test', so only fill it in when something has cleared it, and reach the
// variable through the mutable env record to stay type-safe.
const mutableEnv: Record<string, string | undefined> = process.env;
mutableEnv.NODE_ENV ??= 'test';
