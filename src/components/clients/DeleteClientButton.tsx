'use client';

import { useActionState, useState } from 'react';

import type { ActionResult } from '@/lib/action-result';
import { Button } from '@/components/ui/Button';
import { SubmitButton } from '@/components/ui/SubmitButton';

export function DeleteClientButton({
  clientId,
  clientName,
  action,
}: {
  clientId: string;
  clientName: string;
  action: (
    previous: ActionResult<undefined> | null,
    formData: FormData,
  ) => Promise<ActionResult<undefined>>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    action,
    null,
  );

  const failed = state && !state.ok ? state : null;

  if (!confirming) {
    return (
      <div className="text-right">
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          削除
        </Button>
        {failed ? <p className="mt-1 text-xs text-red-600">{failed.message}</p> : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="id" value={clientId} />
      <span className="text-xs text-ink-600">{clientName} を削除しますか？</span>
      <SubmitButton variant="danger" pendingLabel="削除中…">
        削除する
      </SubmitButton>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        キャンセル
      </Button>
    </form>
  );
}
