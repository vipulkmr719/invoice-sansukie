import NextAuth from 'next-auth';

import authConfig from '@/auth.config';

/**
 * Edge proxy (Next 16's replacement for the `middleware` convention).
 *
 * Auth.js verifies the session JWT's signature here, at the edge, and the
 * `authorized` callback in `auth.config.ts` decides whether the request may
 * proceed. An unauthenticated request to a protected route is redirected to
 * `/login` before the page renders.
 *
 * This is a gate, not the security boundary. Every protected page calls
 * `requireUser()` again — which re-checks the account against the database —
 * and every query is scoped by the authenticated user id. Removing this file
 * would cost a redirect, not isolation.
 *
 * `auth.config.ts` is imported rather than `auth.ts` because the Edge runtime
 * has no Prisma and no `node:crypto`.
 */
const { auth } = NextAuth(authConfig);

// Next 16 requires a recognisable function export named `proxy`; a destructured
// const is not statically recognised as one.
export default auth;

export const config = {
  /*
   * Match everything except Next internals and static files, so the gate also
   * covers routes added later. `authorized` decides what is actually
   * protected.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.png$).*)'],
};
