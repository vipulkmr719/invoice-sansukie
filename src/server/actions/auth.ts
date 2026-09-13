'use server';

import { randomUUID } from 'node:crypto';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  actionFailure,
  collectValues,
  type ActionResult,
} from '@/lib/action-result';
import { toPublicErrorMessage } from '@/lib/errors';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { clearSessionCookie, setSessionCookie } from '@/server/auth/session';
import { createUser, findUserByEmail } from '@/server/db/users';
import { loginSchema, registerSchema } from '@/validation/auth';

/**
 * Authentication actions.
 *
 * `'use server'` means every function here runs on the server no matter who
 * calls it, and Next.js will not include the module in a client bundle.
 * FormData arriving here is hostile until Zod says otherwise.
 */

function fieldErrorsOf(error: z.ZodError): Record<string, string[] | undefined> {
  return z.flattenError(error).fieldErrors;
}

/**
 * A real scrypt hash of a value nobody can log in with, computed once.
 * Verifying against it costs the same as verifying a genuine credential, which
 * is what keeps login timing from revealing whether an address is registered.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomUUID());
  return dummyHashPromise;
}

export async function registerAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  // The email is echoed back on failure; the passwords deliberately are not.
  const values = collectValues(formData, ['email']);

  const parsed = registerSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return actionFailure('入力内容をご確認ください。', {
      fieldErrors: fieldErrorsOf(parsed.error),
      values,
    });
  }

  try {
    const existing = await findUserByEmail(parsed.data.email);
    if (existing) {
      return actionFailure('入力内容をご確認ください。', {
        fieldErrors: { email: ['このメールアドレスは登録できません。'] },
        values,
      });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await createUser(parsed.data.email, passwordHash);

    await setSessionCookie(user.id);
  } catch (error) {
    return actionFailure(toPublicErrorMessage(error, 'registerAction'), { values });
  }

  // redirect() throws a control-flow signal — it must sit outside the try.
  redirect('/settings?welcome=1');
}

export async function loginAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const values = collectValues(formData, ['email']);

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return actionFailure('メールアドレスまたはパスワードが正しくありません。', { values });
  }

  try {
    const user = await findUserByEmail(parsed.data.email);

    // Always run the full scrypt comparison — against a decoy hash when the
    // account does not exist — so response time does not reveal which
    // addresses are registered.
    const passwordMatches = await verifyPassword(
      parsed.data.password,
      user?.passwordHash ?? (await getDummyHash()),
    );

    if (!user || !passwordMatches) {
      return actionFailure('メールアドレスまたはパスワードが正しくありません。', { values });
    }

    await setSessionCookie(user.id);
  } catch (error) {
    return actionFailure(toPublicErrorMessage(error, 'loginAction'), { values });
  }

  redirect('/dashboard');
}

export async function logoutAction(): Promise<never> {
  await clearSessionCookie();
  redirect('/login');
}
