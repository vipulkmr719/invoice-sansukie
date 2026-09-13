'use client';

import { useActionState, useState } from 'react';

import type { ActionResult } from '@/lib/action-result';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { SubmitButton } from '@/components/ui/SubmitButton';

/**
 * The toolbar above an invoice: download the server-rendered PDF, or delete.
 *
 * "PDFをダウンロード" fetches `/invoices/:id/pdf`, which renders the document
 * with Puppeteer on the server. Going through `fetch` rather than a plain link
 * lets the button show progress and surface the route's JSON error instead of
 * navigating the user to a blob of error text.
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
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [state, formAction] = useActionState<ActionResult<undefined> | null, FormData>(
    deleteAction,
    null,
  );

  const failed = state && !state.ok ? state : null;

  async function downloadPdf() {
    setDownloading(true);
    setDownloadError(null);

    let objectUrl: string | null = null;

    try {
      const response = await fetch(`/invoices/${invoiceId}/pdf`);

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message =
          body && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : 'PDFの生成に失敗しました。';
        setDownloadError(message);
        return;
      }

      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `invoice-${invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setDownloadError('PDFの生成に失敗しました。通信状況をご確認ください。');
    } finally {
      if (objectUrl !== null) {
        // Revoke after the click has been handled so the download still starts.
        const url = objectUrl;
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setDownloading(false);
    }
  }

  return (
    <div className="no-print">
      {failed ? (
        <Alert tone="error" className="mb-4">
          {failed.message}
        </Alert>
      ) : null}

      {downloadError ? (
        <Alert tone="error" className="mb-4">
          {downloadError}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={downloadPdf} disabled={downloading}>
          {downloading ? 'PDFを生成中…' : 'PDFをダウンロード'}
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
