import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe half of the Auth.js configuration.
 *
 * The proxy (edge middleware) runs on the Edge runtime, where Prisma and
 * `node:crypto` are unavailable. This file therefore contains only what the
 * edge needs — page routes, cookie/session policy and the route-authorisation
 * callback — and deliberately declares no providers. `src/auth.ts` adds the
 * Credentials provider for the Node runtime.
 */

/** Routes that require a signed-in user. */
export const PROTECTED_PREFIXES = [
  '/dashboard',
  '/invoices',
  '/clients',
  '/settings',
  '/upgrade',
  '/payment',
] as const;

/**
 * Endpoints that answer with data rather than a page. These must not be
 * redirected: a client fetching a PDF should get 401 with a JSON body, not an
 * HTML login page under a 200. Their own handlers authorise the request.
 */
const DATA_ENDPOINTS = [/^\/invoices\/[^/]+\/pdf$/];

export function isProtectedPath(pathname: string): boolean {
  if (DATA_ENDPOINTS.some((pattern) => pattern.test(pathname))) return false;

  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export const authConfig = {
  // Sessions are JWTs: the Credentials provider cannot use database sessions,
  // and a stateless token keeps the edge check free of a database round trip.
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  // Behind a proxy/container the Host header is what identifies the site.
  trustHost: true,

  providers: [],

  callbacks: {
    /**
     * Edge gate. Runs before a protected page renders and verifies the session
     * JWT's signature — not merely that a cookie exists.
     *
     * This is an optimisation, not the security boundary: `requireUser()` runs
     * again on every protected page and re-checks the account against the
     * database, and every query is scoped by the authenticated user id.
     */
    authorized({ auth, request }) {
      const signedIn = Boolean(auth?.user?.id);
      const { pathname } = request.nextUrl;

      if (isProtectedPath(pathname)) {
        return signedIn;
      }

      return true;
    },

    /** Persist the user id on the token; it is the tenant key for every query. */
    jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },

    /** Expose the user id (and nothing more sensitive) on the session. */
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
