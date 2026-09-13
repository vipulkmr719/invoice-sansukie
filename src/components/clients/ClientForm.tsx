'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import type { ActionResult } from '@/lib/action-result';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, TextArea, TextInput } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';

export function ClientForm({
  action,
}: {
  action: (
    previous: ActionResult<undefined> | null,
    formData: FormData,
  ) => Promise<ActionResult<undefined>>;
}) {
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    action,
    null,
  );

  const failed = state && !state.ok ? state : null;
  const fieldErrors = failed?.fieldErrors ?? {};

  // Repopulate after a rejected submit — see CompanyForm for why.
  const submitted = failed?.values;

  return (
    <form action={formAction} className="space-y-6">
      {failed ? <Alert tone="error">{failed.message}</Alert> : null}

      <Card>
        <CardHeader
          title="顧客情報"
          description="請求書の宛名として使用されます。会社名を入力すると「◯◯御中」と表示されます。"
        />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="顧客名（担当者名・宛名）" htmlFor="name" required errors={fieldErrors.name}>
            <TextInput
              id="name"
              name="name"
              defaultValue={submitted?.name ?? ''}
              required
              maxLength={100}
              placeholder="山田 太郎"
              invalid={Boolean(fieldErrors.name)}
            />
          </Field>

          <Field label="会社名" htmlFor="companyName" errors={fieldErrors.companyName}>
            <TextInput
              id="companyName"
              name="companyName"
              defaultValue={submitted?.companyName ?? ''}
              maxLength={100}
              placeholder="株式会社サンプル"
              invalid={Boolean(fieldErrors.companyName)}
            />
          </Field>

          <Field label="メールアドレス" htmlFor="email" errors={fieldErrors.email}>
            <TextInput
              id="email"
              name="email"
              defaultValue={submitted?.email ?? ''}
              type="email"
              maxLength={254}
              placeholder="contact@example.com"
              invalid={Boolean(fieldErrors.email)}
            />
          </Field>

          <Field label="電話番号" htmlFor="phone" errors={fieldErrors.phone}>
            <TextInput
              id="phone"
              name="phone"
              defaultValue={submitted?.phone ?? ''}
              type="tel"
              placeholder="03-1234-5678"
              className="tabular"
              invalid={Boolean(fieldErrors.phone)}
            />
          </Field>

          <Field
            label="住所"
            htmlFor="address"
            errors={fieldErrors.address}
            className="sm:col-span-2"
          >
            <TextArea
              id="address"
              name="address"
              defaultValue={submitted?.address ?? ''}
              maxLength={300}
              placeholder={'〒100-0001\n東京都千代田区千代田1-1'}
              invalid={Boolean(fieldErrors.address)}
            />
          </Field>
        </CardBody>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Link
          href="/clients"
          className="inline-flex items-center justify-center rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
        >
          キャンセル
        </Link>
        <SubmitButton pendingLabel="保存中…">保存</SubmitButton>
      </div>
    </form>
  );
}
