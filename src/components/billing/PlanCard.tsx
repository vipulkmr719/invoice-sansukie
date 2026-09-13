'use client';

import { useActionState } from 'react';

import type { ActionResult } from '@/lib/action-result';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { cn } from '@/lib/cn';

export function PlanCard({
  kind,
  title,
  price,
  cadence,
  features,
  highlighted,
  available,
  action,
}: {
  kind: 'monthly' | 'lifetime';
  title: string;
  price: string;
  cadence: string;
  features: string[];
  highlighted?: boolean;
  available: boolean;
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

  return (
    <Card className={cn('flex flex-col', highlighted && 'ring-2 ring-brand-500')}>
      <CardBody className="flex flex-1 flex-col">
        {highlighted ? (
          <span className="mb-3 inline-flex w-fit items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
            おすすめ
          </span>
        ) : null}

        <h2 className="text-base font-semibold text-ink-900">{title}</h2>

        <p className="mt-3 flex items-baseline gap-1.5">
          <span className="tabular text-3xl font-bold tracking-tight text-ink-900">
            {price}
          </span>
          <span className="text-sm text-ink-500">{cadence}</span>
        </p>

        <ul className="mt-5 flex-1 space-y-2.5 text-sm text-ink-600">
          {features.map((feature) => (
            <li key={feature} className="flex gap-2.5">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-brand-600"
              >
                <path d="m20 6-11 11-5-5" />
              </svg>
              {feature}
            </li>
          ))}
        </ul>

        {failed ? (
          <Alert tone="error" className="mt-5">
            {failed.message}
          </Alert>
        ) : null}

        <form action={formAction} className="mt-6">
          <input type="hidden" name="kind" value={kind} />
          <SubmitButton
            pendingLabel="お支払いページへ移動中…"
            variant={highlighted ? 'primary' : 'secondary'}
            className="w-full"
          >
            {available ? 'このプランにする' : '現在ご利用いただけません'}
          </SubmitButton>
        </form>
      </CardBody>
    </Card>
  );
}
