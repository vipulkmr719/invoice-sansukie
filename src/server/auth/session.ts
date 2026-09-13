import 'server-only';

import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

import { env, isProduction } from '@/lib/env';

/**
 * Session handling.
 *
 * The session is a short-lived JWT signed with `AUTH_SECRET` (HS256) and stored
 * in an httpOnly, SameSite=Lax cookie. httpOnly keeps it out of reach of any
 * script on the page; SameSite=Lax is what blocks a cross-site form from
 * driving a server action with the user's credentials.
 *
 * The token carries only the user id — never an email, never a role, never
 * anything that would be sensitive if a token leaked.
 */

export const SESSION_COOKIE_NAME = 'invoice_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const ISSUER = 'invoice-sakusei';
const AUDIENCE = 'invoice-sakusei-app';

const secretKey = new TextEncoder().encode(env.AUTH_SECRET);

export interface SessionPayload {
  userId: string;
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey);
}

/** Verify a token's signature, issuer, audience and expiry. */
export async function verifySessionToken(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return null;
    }

    return { userId: payload.sub };
  } catch {
    // Expired, tampered with, or simply not ours. Either way: no session.
    return null;
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const token = await createSessionToken(userId);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** Read and verify the session from the incoming request's cookies. */
export async function readSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}
