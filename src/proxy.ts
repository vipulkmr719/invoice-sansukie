import { NextResponse, type NextRequest } from 'next/server';
import NextAuth from 'next-auth';

import authConfig from '@/auth.config';
import { isProtectedPath } from '@/auth.config';
import { buildSecurityHeaders, generateNonce } from '@/lib/security-headers';
import { isSecureDeployment } from '@/lib/transport';

/**
 * Edge proxy (Next 16's replacement for the `middleware` convention).
 *
 * Two jobs, in this order:
 *
 *  1. **Security headers.** A per-request nonce is generated and placed in the
 *     Content-Security-Policy on both the forwarded request and the response.
 *     Next.js reads the nonce out of the request's CSP header and stamps it
 *     onto the inline scripts it injects, which is what lets the policy avoid
 *     `'unsafe-inline'` entirely.
 *
 *  2. **Authentication gate.** Auth.js verifies the session JWT's signature
 *     here, at the edge, and redirects an anonymous request to a protected
 *     route before the page renders.
 *
 * The gate is an optimisation, not the security boundary: every protected page
 * calls `requireUser()` again — which re-checks the account against the
 * database — and every query is scoped by the authenticated user id.
 */

const { auth } = NextAuth(authConfig);

const IS_SECURE_TRANSPORT = isSecureDeployment();

/**
 * The origin a browser actually reached us on.
 *
 * Behind a TLS-terminating proxy `request.nextUrl.origin` is the *internal*
 * address the Node process listens on (http://localhost:3000), not the public
 * one. Building the sign-in redirect from it puts an unreachable URL in a
 * user-visible `callbackUrl`: Auth.js then discards it as off-origin — so it
 * is not an open redirect — but the visitor loses the page they asked for, and
 * an internal hostname ends up in a query string that gets logged and shared.
 *
 * `APP_URL` is the operator's own declaration of the public origin, so it is
 * used in preference and, unlike `X-Forwarded-Host`, cannot be spoofed by a
 * caller. It must therefore carry a non-default port if the public origin has
 * one. When it is unset we fall back to the request's own origin, which is
 * correct for a deployment with nothing in front.
 */
function publicOrigin(request: NextRequest): string {
  const declared = process.env.APP_URL;
  if (declared && /^https?:\/\//.test(declared)) {
    try {
      return new URL(declared).origin;
    } catch {
      // Malformed APP_URL: fall through rather than break sign-in.
    }
  }
  return request.nextUrl.origin;
}

function applySecurityHeaders(response: NextResponse, nonce: string): NextResponse {
  for (const [name, value] of Object.entries(
    buildSecurityHeaders({ nonce, isSecureTransport: IS_SECURE_TRANSPORT }),
  )) {
    response.headers.set(name, value);
  }
  return response;
}

export default async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const headers = buildSecurityHeaders({
    nonce,
    isSecureTransport: IS_SECURE_TRANSPORT,
  });

  // Forward the CSP (and the nonce) to the renderer so Next can stamp its
  // inline scripts. Without this the nonce in the response header would match
  // nothing and hydration would be blocked.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', headers['Content-Security-Policy'] ?? '');

  // Auth.js decides whether this request may proceed. `auth()` returns either
  // a redirect (anonymous, protected route) or undefined/next.
  const session = await auth();
  const signedIn = Boolean(session?.user?.id);

  if (isProtectedPath(request.nextUrl.pathname) && !signedIn) {
    const loginUrl = new URL('/login', publicOrigin(request));
    loginUrl.searchParams.set(
      'callbackUrl',
      new URL(request.nextUrl.pathname + request.nextUrl.search, publicOrigin(request)).href,
    );
    return applySecurityHeaders(NextResponse.redirect(loginUrl), nonce);
  }

  return applySecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    nonce,
  );
}

export const config = {
  /*
   * Match everything except Next's own static output, so the headers also
   * cover routes added later. Static chunks are immutable and served with
   * their own caching; they need no per-request policy.
   */
  matcher: ['/((?!_next/static|_next/image).*)'],
};
