'use client';

import { useActionState } from 'react';

import type { ActionResult } from '@/lib/action-result';
import type { CompanyDTO } from '@/server/db/types';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, TextArea, TextInput } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';

export function CompanyForm({
  company,
  action,
}: {
  company: CompanyDTO | null;
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
  const succeeded = state?.ok === true;
  const fieldErrors = failed?.fieldErrors ?? {};

  /**
   * React resets an uncontrolled form once its action resolves, so after a
   * rejected submit the defaults have to be what the user last typed — not the
   * stored record — or a single typo would clear the whole form.
   */
  const submitted = failed?.values;
  const initial = (field: string, stored: string) => submitted?.[field] ?? stored;

  return (
    <form action={formAction} className="space-y-6">
      {failed ? <Alert tone="error">{failed.message}</Alert> : null}
      {succeeded ? <Alert tone="success">自社情報を保存しました。</Alert> : null}

      <Card>
        <CardHeader
          title="自社情報"
          description="ここで登録した内容が、発行するすべての請求書に記載されます。"
        />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field
            label="会社名・屋号"
            htmlFor="name"
            required
            errors={fieldErrors.name}
            className="sm:col-span-2"
          >
            <TextInput
              id="name"
              name="name"
              defaultValue={initial('name', company?.name ?? '')}
              required
              maxLength={100}
              placeholder="株式会社インボイス"
              invalid={Boolean(fieldErrors.name)}
            />
          </Field>

          <Field
            label="登録番号"
            htmlFor="registrationNumber"
            hint="適格請求書発行事業者登録番号。「T」+ 数字13桁で入力してください。"
            required
            errors={fieldErrors.registrationNumber}
            className="sm:col-span-2"
          >
            <TextInput
              id="registrationNumber"
              name="registrationNumber"
              defaultValue={initial('registrationNumber', company?.registrationNumber ?? '')}
              required
              placeholder="T1234567890123"
              className="tabular"
              autoComplete="off"
              invalid={Boolean(fieldErrors.registrationNumber)}
            />
          </Field>

          <Field label="メールアドレス" htmlFor="email" required errors={fieldErrors.email}>
            <TextInput
              id="email"
              name="email"
              type="email"
              defaultValue={initial('email', company?.email ?? '')}
              required
              maxLength={254}
              placeholder="info@example.com"
              invalid={Boolean(fieldErrors.email)}
            />
          </Field>

          <Field label="電話番号" htmlFor="phone" required errors={fieldErrors.phone}>
            <TextInput
              id="phone"
              name="phone"
              type="tel"
              defaultValue={initial('phone', company?.phone ?? '')}
              required
              placeholder="03-1234-5678"
              className="tabular"
              invalid={Boolean(fieldErrors.phone)}
            />
          </Field>

          <Field
            label="住所"
            htmlFor="address"
            required
            errors={fieldErrors.address}
            className="sm:col-span-2"
          >
            <TextArea
              id="address"
              name="address"
              defaultValue={initial('address', company?.address ?? '')}
              required
              maxLength={300}
              placeholder={'〒100-0001\n東京都千代田区千代田1-1 サンプルビル5F'}
              invalid={Boolean(fieldErrors.address)}
            />
          </Field>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="保存中…">保存</SubmitButton>
      </div>
    </form>
  );
}
