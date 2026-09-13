import Link from 'next/link';

import { MonthlyChart } from '@/components/dashboard/MonthlyChart';
import { StatCard } from '@/components/dashboard/StatCard';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatYen } from '@/domain/money';
import { formatSlashDate, isOverdue } from '@/lib/date';
import { requireUser } from '@/server/auth/guard';
import { getCompanyForUser } from '@/server/db/companies';
import { getDashboardStats } from '@/server/db/invoices';

export const metadata = { title: 'ダッシュボード' };

// Figures must reflect the latest write, so this page is never cached.
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();

  const [stats, company] = await Promise.all([
    getDashboardStats(user.id),
    getCompanyForUser(user.id),
  ]);

  return (
    <>
      <PageHeader
        title="ダッシュボード"
        description="請求状況の概要を確認できます。"
        action={<ButtonLink href="/invoices/new">請求書を作成</ButtonLink>}
      />

      {!company ? (
        <Alert tone="warning" className="mb-6">
          <span className="font-medium">自社情報が未設定です。</span>{' '}
          請求書に登録番号や住所を記載するために、まず
          <Link href="/settings" className="mx-1 font-medium underline">
            設定
          </Link>
          から自社情報を登録してください。
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="今月の請求額"
          value={formatYen(stats.currentMonthBilled)}
          sublabel={`${stats.currentMonthCount}件の請求書`}
          tone="brand"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          }
        />
        <StatCard
          label="累計請求額"
          value={formatYen(stats.totalBilled)}
          sublabel={`${stats.invoiceCount}件の請求書`}
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="m19 9-5 5-4-4-3 3" />
            </svg>
          }
        />
        <StatCard
          label="消費税合計"
          value={formatYen(stats.taxTotal)}
          sublabel="8%・10%の合算"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 5 5 19" />
              <circle cx="7.5" cy="7.5" r="2.5" />
              <circle cx="16.5" cy="16.5" r="2.5" />
            </svg>
          }
        />
        <StatCard
          label="支払期限超過"
          value={`${stats.overdueCount}件`}
          sublabel={stats.overdueCount > 0 ? formatYen(stats.overdueTotal) : '該当なし'}
          tone={stats.overdueCount > 0 ? 'warning' : 'neutral'}
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          }
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader title="月別の請求額" description="直近6か月の推移" />
          <CardBody>
            <MonthlyChart data={stats.monthlyTotals} />
          </CardBody>
        </Card>

        <Card className="min-w-0 lg:col-span-2">
          <CardHeader
            title="登録状況"
            description="請求書の発行に必要な情報"
          />
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-600">自社情報</span>
              {company ? (
                <Badge tone="success">登録済み</Badge>
              ) : (
                <Badge tone="warning">未登録</Badge>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-600">登録番号</span>
              <span className="tabular text-sm font-medium text-ink-800">
                {company ? company.registrationNumber : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-600">登録済み顧客</span>
              <span className="tabular text-sm font-medium text-ink-800">
                {stats.clientCount}件
              </span>
            </div>
            <div className="border-t border-ink-200/70 pt-4">
              <ButtonLink href="/settings" variant="secondary" size="sm">
                設定を開く
              </ButtonLink>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="最近の請求書"
          action={
            stats.recentInvoices.length > 0 ? (
              <ButtonLink href="/invoices" variant="secondary" size="sm">
                請求書一覧
              </ButtonLink>
            ) : null
          }
        />
        {stats.recentInvoices.length === 0 ? (
          <EmptyState
            title="まだ請求書がありません"
            description="最初の請求書を作成すると、ここに表示されます。"
            action={<ButtonLink href="/invoices/new">請求書を作成</ButtonLink>}
          />
        ) : (
          <ul className="divide-y divide-ink-200/70">
            {stats.recentInvoices.map((invoice) => (
              <li key={invoice.id}>
                <Link
                  href={`/invoices/${invoice.id}`}
                  className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-ink-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabular text-sm font-semibold text-ink-900">
                        {invoice.invoiceNumber}
                      </span>
                      {isOverdue(invoice.dueDate) ? (
                        <Badge tone="warning">期限超過</Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-500">
                      {invoice.clientCompanyName ?? invoice.clientName}
                      <span className="mx-2 text-ink-300">·</span>
                      発行 {formatSlashDate(invoice.issueDate)}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-sm font-semibold text-ink-900">
                    {formatYen(invoice.total)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
