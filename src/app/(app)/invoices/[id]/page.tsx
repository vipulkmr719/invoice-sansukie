import { notFound } from 'next/navigation';
import Link from 'next/link';

import { InvoiceActions } from '@/components/invoices/InvoiceActions';
import { InvoiceSheet } from '@/components/invoices/InvoiceSheet';
import { Alert } from '@/components/ui/Alert';
import { deleteInvoiceAction } from '@/server/actions/invoices';
import { requireUser } from '@/server/auth/guard';
import { getCompanyForUser } from '@/server/db/companies';
import { getInvoiceForUser } from '@/server/db/invoices';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const invoice = await getInvoiceForUser(user.id, id);

  return { title: invoice ? `請求書 ${invoice.invoiceNumber}` : '請求書' };
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requireUser();
  const [{ id }, query] = await Promise.all([params, searchParams]);

  // Scoped by userId inside the repository — another account's id resolves to
  // null here and renders the same 404 as a non-existent one.
  const invoice = await getInvoiceForUser(user.id, id);
  if (!invoice) {
    notFound();
  }

  const company = await getCompanyForUser(user.id);

  return (
    <>
      <div className="no-print mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/invoices"
            className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            請求書一覧
          </Link>
          <h1 className="tabular mt-1.5 text-xl font-bold tracking-tight text-ink-900 sm:text-2xl">
            {invoice.invoiceNumber}
          </h1>
        </div>

        <InvoiceActions
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoiceNumber}
          deleteAction={deleteInvoiceAction}
        />
      </div>

      {query.created ? (
        <Alert tone="success" className="no-print mb-6">
          請求書を作成しました。「PDFをダウンロード」から保存できます。
        </Alert>
      ) : null}

      {!company ? (
        <Alert tone="warning" className="no-print mb-6">
          自社情報が未登録のため、発行者名と登録番号が印字されません。
          <Link href="/settings" className="ml-1 font-medium underline">
            設定
          </Link>
          から登録してください。
        </Alert>
      ) : null}

      <InvoiceSheet invoice={invoice} company={company} />
    </>
  );
}
