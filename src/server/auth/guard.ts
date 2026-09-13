import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { UnauthorizedError } from '@/lib/errors';
import { findUserById } from '@/server/db/users';

/**
 * The single source of the authenticated identity.
 *
 * Every protected page and every server action resolves the current user
 * through this module, and every repository call takes the resulting `id` as
 * its tenant key. Nothing else in the application may decide who the caller is.
 */

export interface AuthenticatedUser {
  id: string;
  email: string;
}

/**
 * Resolve the signed-in user, or null.
 *
 * `cache()` deduplicates this within a single render pass, so a layout, a page
 * and three server components asking "who is signed in?" cost one query.
 *
 * The token's subject is re-checked against the database on every request: a
 * deleted account must stop working immediately, not when its JWT expires.
 * Auth.js has already verified the token's signature and expiry by this point.
 */
export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const session = await auth();

  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await findUserById(userId);
  if (!user) return null;

  return { id: user.id, email: user.email };
});

/**
 * For pages: send anonymous visitors to the login screen.
 * Every authenticated page calls this before touching any data.
 */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}

/**
 * For server actions: throw rather than redirect, so the action can report the
 * failure through its own result shape.
 */
export async function requireUserForAction(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}
