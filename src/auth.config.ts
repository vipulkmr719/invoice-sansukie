import type { NextAuthConfig } from 'next-auth';

import { isSecureDeployment } from '@/lib/transport';

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

/**
 * Whether to send cookies with the `Secure` attribute and the `__Secure-`
 * name prefix.
 *
 * Driven by the deployment's own public origin rather than NODE_ENV: a staging
 * build running in production mode behind plain HTTP would otherwise set
 * Secure cookies the browser refuses to store, and the session would silently
 * never persist. `__Secure-` is enforced by the browser — a cookie with that
 * prefix is rejected unless it is Secure and from an https origin — so a
 * downgrade attack cannot overwrite the session cookie over HTTP.
 */
const useSecureCookies = isSecureDeployment();

export const authConfig = {
  // Sessions are JWTs: the Credentials provider cannot use database sessions,
  // and a stateless token keeps the edge check free of a database round trip.
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    // Re-issue the token at most once a day, so a revoked account's window is
    // bounded by requireUser()'s database check rather than the token's life.
    updateAge: 60 * 60 * 24,
  },

  useSecureCookies,

  cookies: {
    /*
     * The session cookie. httpOnly keeps it away from any script on the page —
     * the single most valuable property here, since it means an XSS bug cannot
     * exfiltrate a session. SameSite=Lax is what blocks a cross-site form or
     * image from driving a state-changing request with the user's credentials,
     * while still allowing a normal top-level link into the app.
     *
     * Strict would be marginally tighter but breaks returning from Stripe
     * Checkout, where the browser arrives from an external origin and must
     * still be signed in.
     */
    sessionToken: {
      name: `${useSecureCookies ? '__Secure-' : ''}authjs.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },

    /*
     * The CSRF token is a double-submit cookie: Auth.js compares the value in
     * this cookie against the one posted in the body. `__Host-` is the
     * strongest prefix available — the browser accepts it only when the cookie
     * is Secure, path=/ and has no Domain attribute, which prevents a
     * subdomain from setting or overwriting it.
     */
    csrfToken: {
      name: `${useSecureCookies ? '__Host-' : ''}authjs.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },

    callbackUrl: {
      name: `${useSecureCookies ? '__Secure-' : ''}authjs.callback-url`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: useSecureCookies,
      },
    },
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
