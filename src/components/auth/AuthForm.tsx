'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import type { ActionResult } from '@/lib/action-result';
import { Alert } from '@/components/ui/Alert';
import { Field, TextInput } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { PASSWORD_MIN_LENGTH } from '@/domain/limits';

type AuthAction = (
  previous: ActionResult<undefined> | null,
  formData: FormData,
) => Promise<ActionResult<undefined>>;

export function LoginForm({ action }: { action: AuthAction }) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    action,
    null,
  );

  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="rounded-xl border border-ink-200/70 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-bold text-ink-900">ログイン</h1>
      <p className="mt-1.5 text-sm text-ink-500">
        アカウントにログインして請求書を管理します。
      </p>

      {failed ? (
        <Alert tone="error" className="mt-5">
          {failed.message}
        </Alert>
      ) : null}

      <div className="mt-6 space-y-4">
        <Field label="メールアドレス" htmlFor="email" required>
          <TextInput
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={failed?.values?.email ?? ''}
            placeholder="you@example.com"
          />
        </Field>

        <Field label="パスワード" htmlFor="password" required>
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
      </div>

      <div className="mt-6">
        <SubmitButton pendingLabel="ログイン中…" className="w-full">
          ログイン
        </SubmitButton>
      </div>

      <p className="mt-5 text-center text-sm text-ink-500">
        アカウントをお持ちでない方は{' '}
        <Link href="/register" className="font-medium text-brand-600 hover:underline">
          新規登録
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ action }: { action: AuthAction }) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    action,
    null,
  );

  const failed = state && !state.ok ? state : null;
  const fieldErrors = failed?.fieldErrors ?? {};

  return (
    <form action={formAction} className="rounded-xl border border-ink-200/70 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-bold text-ink-900">新規登録</h1>
      <p className="mt-1.5 text-sm text-ink-500">
        メールアドレスとパスワードでアカウントを作成します。
      </p>

      {failed ? (
        <Alert tone="error" className="mt-5">
          {failed.message}
        </Alert>
      ) : null}

      <div className="mt-6 space-y-4">
        <Field
          label="メールアドレス"
          htmlFor="register-email"
          required
          errors={fieldErrors.email}
        >
          <TextInput
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={failed?.values?.email ?? ''}
            invalid={Boolean(fieldErrors.email)}
            placeholder="you@example.com"
          />
        </Field>

        <Field
          label="パスワード"
          htmlFor="register-password"
          hint={`${PASSWORD_MIN_LENGTH}文字以上、英字と数字を含めてください。`}
          required
          errors={fieldErrors.password}
        >
          <TextInput
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            invalid={Boolean(fieldErrors.password)}
          />
        </Field>

        <Field
          label="パスワード（確認）"
          htmlFor="register-confirm"
          required
          errors={fieldErrors.confirmPassword}
        >
          <TextInput
            id="register-confirm"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            invalid={Boolean(fieldErrors.confirmPassword)}
          />
        </Field>
      </div>

      <div className="mt-6">
        <SubmitButton pendingLabel="登録中…" className="w-full">
          アカウントを作成
        </SubmitButton>
      </div>

      <p className="mt-5 text-center text-sm text-ink-500">
        すでにアカウントをお持ちの方は{' '}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          ログイン
        </Link>
      </p>
    </form>
  );
}
