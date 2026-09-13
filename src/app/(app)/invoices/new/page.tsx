import Link from 'next/link';
import { redirect } from 'next/navigation';

import { InvoiceForm } from '@/components/invoices/InvoiceForm';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/Alert';
import { addDaysUtc, toDateInputValue, todayUtc } from '@/lib/date';
import { createInvoiceAction } from '@/server/actions/invoices';
import { requireUser } from '@/server/auth/guard';
import { getInvoiceQuotaForUser } from '@/server/db/billing';
import { listClientsForUser } from '@/server/db/clients';
import { getCompanyForUser } from '@/server/db/companies';
import { suggestInvoiceNumber } from '@/server/db/invoices';

export const metadata = { title: '新しい請求書' };

export const dynamic = 'force-dynamic';

/** Default payment terms: end of the following month is the common convention. */
const DEFAULT_PAYMENT_DAYS = 30;

export default async function NewInvoicePage() {
  const user = await requireUser();

  const [clients, invoiceNumber, company, quota] = await Promise.all([
    listClientsForUser(user.id),
    suggestInvoiceNumber(user.id),
    getCompanyForUser(user.id),
    getInvoiceQuotaForUser(user.id),
  ]);

  // Step 1-2 of the payment flow: at the free limit, the upgrade page is shown
  // instead of a form that would only fail on submit. The server action checks
  // the quota again regardless — this redirect is for the user, not for
  // security.
  if (!quota.canCreate) {
    redirect('/upgrade?reason=quota');
  }

  const today = todayUtc();

  return (
    <>
      <PageHeader
        title="新しい請求書"
        description="明細と税率を入力すると、消費税額と合計を自動で計算します。"
      />

      {quota.limit !== null ? (
        <Alert tone={quota.remaining !== null && quota.remaining <= 1 ? 'warning' : 'info'} className="mb-6">
          無料プランの残り作成可能数は{quota.remaining}件です（{quota.used}/{quota.limit}件を使用）。
          <Link href="/upgrade" className="ml-1 font-medium underline">
            アップグレード
          </Link>
          すると無制限に作成できます。
        </Alert>
      ) : null}

      {!company ? (
        <Alert tone="warning" className="mb-6">
          自社情報が未設定です。下の「発行者情報」に入力すればこの請求書は作成できますが、
          <Link href="/settings" className="mx-1 font-medium underline">
            設定
          </Link>
          に登録しておくと次回から自動で入力されます。
        </Alert>
      ) : null}

      <InvoiceForm
        clients={clients}
        company={company}
        defaultInvoiceNumber={invoiceNumber}
        defaultIssueDate={toDateInputValue(today)}
        defaultDueDate={toDateInputValue(addDaysUtc(today, DEFAULT_PAYMENT_DAYS))}
        action={createInvoiceAction}
      />
    </>
  );
}
