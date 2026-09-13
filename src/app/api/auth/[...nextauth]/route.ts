import { handlers } from '@/auth';

/**
 * Auth.js route handler — sign-in, sign-out, session and CSRF endpoints.
 * Must run on the Node runtime: the Credentials provider verifies scrypt
 * hashes and reads the database.
 */
export const runtime = 'nodejs';

export const { GET, POST } = handlers;
