import Link from 'next/link';

import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatYen } from '@/domain/money';
import { formatSlashDate, isOverdue } from '@/lib/date';
import { requireUser } from '@/server/auth/guard';
import { listInvoicesForUser } from '@/server/db/invoices';

export const metadata = { title: '請求書一覧' };

export const dynamic = 'force-dynamic';

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const user = await requireUser();
  const [invoices, params] = await Promise.all([
    listInvoicesForUser(user.id),
    searchParams,
  ]);

  const totalBilled = invoices.reduce((sum, invoice) => sum + invoice.total, 0);

  return (
    <>
      <PageHeader
        title="請求書一覧"
        description={
          invoices.length > 0
            ? `${invoices.length}件 / 合計 ${formatYen(totalBilled)}`
            : undefined
        }
        action={<ButtonLink href="/invoices/new">請求書を作成</ButtonLink>}
      />

      {params.deleted ? (
        <Alert tone="success" className="mb-6">
          請求書を削除しました。
        </Alert>
      ) : null}

      <Card>
        {invoices.length === 0 ? (
          <EmptyState
            title="請求書がまだありません"
            description="最初の請求書を作成しましょう。明細を入力するだけで、税率ごとの消費税額を自動で計算します。"
            action={<ButtonLink href="/invoices/new">請求書を作成</ButtonLink>}
          />
        ) : (
          <>
            {/* Table from sm up */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-200/70 text-left text-xs text-ink-500">
                    <th scope="col" className="px-5 py-3 font-medium">請求書番号</th>
                    <th scope="col" className="px-5 py-3 font-medium">請求先</th>
                    <th scope="col" className="px-5 py-3 font-medium">発行日</th>
                    <th scope="col" className="px-5 py-3 font-medium">支払期限</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">合計（税込）</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-200/70">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="transition-colors hover:bg-ink-50">
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="tabular font-semibold text-ink-900 hover:text-brand-600"
                        >
                          {invoice.invoiceNumber}
                        </Link>
                      </td>
                      <td className="max-w-[16rem] truncate px-5 py-3.5 text-ink-600">
                        {invoice.clientCompanyName ?? invoice.clientName}
                      </td>
                      <td className="tabular px-5 py-3.5 whitespace-nowrap text-ink-600">
                        {formatSlashDate(invoice.issueDate)}
                      </td>
                      <td className="tabular px-5 py-3.5 whitespace-nowrap text-ink-600">
                        <span className="inline-flex items-center gap-2">
                          {formatSlashDate(invoice.dueDate)}
                          {isOverdue(invoice.dueDate) ? (
                            <Badge tone="warning">期限超過</Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="tabular px-5 py-3.5 text-right font-semibold whitespace-nowrap text-ink-900">
                        {formatYen(invoice.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Stacked cards on phones */}
            <ul className="divide-y divide-ink-200/70 sm:hidden">
              {invoices.map((invoice) => (
                <li key={invoice.id}>
                  <Link href={`/invoices/${invoice.id}`} className="block px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="tabular text-sm font-semibold text-ink-900">
                          {invoice.invoiceNumber}
                        </span>
                        <p className="mt-0.5 truncate text-sm text-ink-500">
                          {invoice.clientCompanyName ?? invoice.clientName}
                        </p>
                      </div>
                      <span className="tabular shrink-0 text-sm font-semibold text-ink-900">
                        {formatYen(invoice.total)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                      <span className="tabular">発行 {formatSlashDate(invoice.issueDate)}</span>
                      <span className="text-ink-300">·</span>
                      <span className="tabular">期限 {formatSlashDate(invoice.dueDate)}</span>
                      {isOverdue(invoice.dueDate) ? <Badge tone="warning">期限超過</Badge> : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}
