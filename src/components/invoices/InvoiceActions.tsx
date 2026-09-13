'use client';

import { useActionState, useState } from 'react';

import type { ActionResult } from '@/lib/action-result';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SubmitButton } from '@/components/ui/SubmitButton';

/**
 * The toolbar above an invoice: print-to-PDF and delete.
 *
 * "PDFをダウンロード" calls `window.print()`. The print stylesheet in
 * globals.css strips the app chrome, so the browser's own "PDFとして保存"
 * destination produces a clean A4 document — no PDF library in the bundle and
 * no server-side rendering pass.
 */
export function InvoiceActions({
  invoiceId,
  invoiceNumber,
  deleteAction,
}: {
  invoiceId: string;
  invoiceNumber: string;
  deleteAction: (
    previous: ActionResult<undefined> | null,
    formData: FormData,
  ) => Promise<ActionResult<undefined>>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    deleteAction,
    null,
  );

  const failed = state && !state.ok ? state : null;

  return (
    <div className="no-print">
      {failed ? (
        <Alert tone="error" className="mb-4">
          {failed.message}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => window.print()}>
          PDFをダウンロード
        </Button>

        {confirming ? (
          <form action={formAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={invoiceId} />
            <span className="text-sm text-ink-600">
              {invoiceNumber} を削除しますか？
            </span>
            <SubmitButton variant="danger" pendingLabel="削除中…">
              削除する
            </SubmitButton>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              キャンセル
            </Button>
          </form>
        ) : (
          <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
            削除
          </Button>
        )}
      </div>
    </div>
  );
}
