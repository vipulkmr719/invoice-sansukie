import Link from 'next/link';

import { InvoiceForm } from '@/components/invoices/InvoiceForm';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/Alert';
import { addDaysUtc, toDateInputValue, todayUtc } from '@/lib/date';
import { createInvoiceAction } from '@/server/actions/invoices';
import { requireUser } from '@/server/auth/guard';
import { listClientsForUser } from '@/server/db/clients';
import { getCompanyForUser } from '@/server/db/companies';
import { suggestInvoiceNumber } from '@/server/db/invoices';

export const metadata = { title: '新しい請求書' };

export const dynamic = 'force-dynamic';

/** Default payment terms: end of the following month is the common convention. */
const DEFAULT_PAYMENT_DAYS = 30;

export default async function NewInvoicePage() {
  const user = await requireUser();

  const [clients, invoiceNumber, company] = await Promise.all([
    listClientsForUser(user.id),
    suggestInvoiceNumber(user.id),
    getCompanyForUser(user.id),
  ]);

  const today = todayUtc();

  return (
    <>
      <PageHeader
        title="新しい請求書"
        description="明細と税率を入力すると、消費税額と合計を自動で計算します。"
      />

      {!company ? (
        <Alert tone="warning" className="mb-6">
          自社情報が未設定です。請求書に登録番号を記載するには
          <Link href="/settings" className="mx-1 font-medium underline">
            設定
          </Link>
          で自社情報を登録してください。（未設定でも請求書は作成できます）
        </Alert>
      ) : null}

      <InvoiceForm
        clients={clients}
        defaultInvoiceNumber={invoiceNumber}
        defaultIssueDate={toDateInputValue(today)}
        defaultDueDate={toDateInputValue(addDaysUtc(today, DEFAULT_PAYMENT_DAYS))}
        action={createInvoiceAction}
      />
    </>
  );
}
