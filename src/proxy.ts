import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge proxy (Next 16's replacement for the `middleware` convention) — a cheap
 * first gate only.
 *
 * It checks that a session cookie is *present* so anonymous visitors are
 * redirected without paying for a render. It deliberately does not verify the
 * signature or look the user up: the authoritative check lives in
 * `requireUser()` on every authenticated page, which re-verifies the JWT and
 * confirms the account still exists. This file is an optimisation, never the
 * security boundary.
 */

const SESSION_COOKIE_NAME = 'invoice_session';

const PROTECTED_PREFIXES = ['/dashboard', '/invoices', '/clients', '/settings'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/dashboard/:path*', '/invoices/:path*', '/clients/:path*', '/settings/:path*'],
};
