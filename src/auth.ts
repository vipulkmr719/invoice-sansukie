import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

import { verifyPassword } from '@/server/auth/password';
import { findUserByEmail } from '@/server/db/users';
import { loginSchema } from '@/validation/auth';

import authConfig from './auth.config';

/**
 * Auth.js (NextAuth v5) — Node-runtime configuration.
 *
 * Email/password sign-in only. Notes on the security properties:
 *
 *  - The submitted credentials are re-validated with the same Zod schema the
 *    login form uses; `authorize` never trusts its input.
 *  - Passwords are compared with scrypt in constant time. A plaintext password
 *    is never stored, never logged, and never returned from this function.
 *  - `authorize` returns null for *every* failure — unknown address, wrong
 *    password, account without a password set. Auth.js turns that into one
 *    generic `CredentialsSignin` error, so the UI cannot be used to enumerate
 *    registered addresses.
 *  - The session JWT carries the user id and email only.
 */

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  providers: [
    Credentials({
      id: 'credentials',
      name: 'メールアドレスとパスワード',
      credentials: {
        email: { label: 'メールアドレス', type: 'email' },
        password: { label: 'パスワード', type: 'password' },
      },

      async authorize(credentials) {
        const parsed = loginSchema.safeParse({
          email: credentials?.email,
          password: credentials?.password,
        });

        if (!parsed.success) {
          // Malformed input is indistinguishable from bad credentials.
          return null;
        }

        const user = await findUserByEmail(parsed.data.email);

        // Always run the full comparison — against a decoy hash when the
        // account does not exist — so response time does not reveal which
        // addresses are registered.
        const passwordMatches = await verifyPassword(
          parsed.data.password,
          user?.passwordHash ?? (await getDecoyHash()),
        );

        if (!user || !passwordMatches) {
          return null;
        }

        // Only non-sensitive identity fields reach the token.
        return { id: user.id, email: user.email };
      },
    }),
  ],
});

/**
 * A real scrypt hash of a value nobody can sign in with, computed once per
 * process. Verifying against it costs the same as verifying a genuine
 * credential, which is what keeps login timing from leaking account existence.
 */
let decoyHashPromise: Promise<string> | null = null;

async function getDecoyHash(): Promise<string> {
  decoyHashPromise ??= import('node:crypto').then(async ({ randomUUID }) => {
    const { hashPassword } = await import('@/server/auth/password');
    return hashPassword(randomUUID());
  });

  return decoyHashPromise;
}
