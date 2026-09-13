'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { signIn, signOut } from '@/auth';
import {
  actionFailure,
  collectValues,
  type ActionResult,
} from '@/lib/action-result';
import { toPublicErrorMessage } from '@/lib/errors';
import { hashPassword } from '@/server/auth/password';
import { createUser, findUserByEmail } from '@/server/db/users';
import { registerSchema } from '@/validation/auth';

/**
 * Authentication actions.
 *
 * `'use server'` means every function here runs on the server no matter who
 * calls it, and Next.js will not include the module in a client bundle.
 * FormData arriving here is hostile until Zod says otherwise.
 *
 * Passwords are never logged, never echoed back to the form, and never stored
 * in any form but a scrypt hash. Sign-in failures return one generic message
 * so the response cannot be used to enumerate registered addresses.
 */

/** The one message every sign-in failure produces, whatever the cause. */
const GENERIC_SIGNIN_ERROR = 'メールアドレスまたはパスワードが正しくありません。';

function fieldErrorsOf(error: z.ZodError): Record<string, string[] | undefined> {
  return z.flattenError(error).fieldErrors;
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
    await createUser(parsed.data.email, passwordHash);

    // Sign the new account in through Auth.js so exactly one code path issues
    // a session. `redirect: false` keeps the control flow here.
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return actionFailure(GENERIC_SIGNIN_ERROR, { values });
    }
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

  const email = formData.get('email');
  const password = formData.get('password');

  if (typeof email !== 'string' || typeof password !== 'string') {
    return actionFailure(GENERIC_SIGNIN_ERROR, { values });
  }

  try {
    // Auth.js validates the credentials in `authorize` (src/auth.ts) and throws
    // CredentialsSignin on any failure.
    await signIn('credentials', { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // One message for every cause: unknown address, wrong password, or an
      // account with no password set.
      return actionFailure(GENERIC_SIGNIN_ERROR, { values });
    }
    return actionFailure(toPublicErrorMessage(error, 'loginAction'), { values });
  }

  redirect('/dashboard');
}

export async function logoutAction(): Promise<void> {
  // Clear the session cookie and redirect as two separate steps.
  //
  // `signOut({ redirectTo })` throws its redirect from inside Auth.js, and the
  // cookie deletion then races the navigation — under load the browser could
  // land on /login still holding a valid session token. `redirect: false`
  // makes the deletion complete before anything is thrown, and the explicit
  // redirect below happens only afterwards.
  await signOut({ redirect: false });

  redirect('/login');
}
