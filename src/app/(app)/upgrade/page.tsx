import Link from 'next/link';

import { PlanCard } from '@/components/billing/PlanCard';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FREE_INVOICE_LIMIT } from '@/domain/entitlement';
import { formatJapaneseDate } from '@/lib/date';
import { isBillingConfigured } from '@/lib/env';
import { startCheckoutAction } from '@/server/actions/billing';
import { requireUser } from '@/server/auth/guard';
import { getBillingForUser, getInvoiceQuotaForUser } from '@/server/db/billing';

export const metadata = { title: 'プランのアップグレード' };

export const dynamic = 'force-dynamic';

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const user = await requireUser();

  const [quota, billing, params] = await Promise.all([
    getInvoiceQuotaForUser(user.id),
    getBillingForUser(user.id),
    searchParams,
  ]);

  return (
    <>
      <PageHeader
        title="プラン"
        description="無料プランの上限に達した場合は、アップグレードすると請求書を無制限に作成できます。"
      />

      {params.reason === 'quota' ? (
        <Alert tone="warning" className="mb-6">
          無料プランで作成できる請求書は{FREE_INVOICE_LIMIT}件までです。
          続けて作成するにはアップグレードしてください。
        </Alert>
      ) : null}

      {!isBillingConfigured ? (
        <Alert tone="info" className="mb-6">
          この環境では決済が構成されていないため、お支払いに進めません。
        </Alert>
      ) : null}

      <Card className="mb-6">
        <CardHeader title="現在のご利用状況" />
        <CardBody>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-ink-500">現在のプラン</dt>
              <dd className="mt-1">
                {quota.isPro ? (
                  <Badge tone="success">
                    {billing?.plan === 'lifetime' ? '買い切り' : '月額プラン'}
                  </Badge>
                ) : (
                  <Badge tone="neutral">無料プラン</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-500">作成済みの請求書</dt>
              <dd className="tabular mt-1 text-sm font-medium text-ink-900">
                {quota.limit === null
                  ? `${quota.used}件（無制限）`
                  : `${quota.used} / ${quota.limit}件`}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-ink-500">
                {billing?.cancelAtPeriodEnd ? 'ご利用期限' : '次回更新日'}
              </dt>
              <dd className="tabular mt-1 text-sm font-medium text-ink-900">
                {billing?.currentPeriodEnd && quota.isPro
                  ? formatJapaneseDate(billing.currentPeriodEnd.slice(0, 10))
                  : '—'}
              </dd>
            </div>
          </dl>

          {billing?.cancelAtPeriodEnd ? (
            <Alert tone="warning" className="mt-4">
              解約手続きが完了しています。期間終了までは引き続きご利用いただけます。
            </Alert>
          ) : null}
        </CardBody>
      </Card>

      {quota.isPro ? (
        <Card>
          <CardBody className="py-10 text-center">
            <h2 className="text-base font-semibold text-ink-900">
              すでに有料プランをご利用中です
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
              請求書は無制限に作成できます。
            </p>
            <Link
              href="/invoices/new"
              className="mt-6 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              請求書を作成
            </Link>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <PlanCard
            kind="monthly"
            title="月額プラン"
            price="¥980"
            cadence="/ 月（税込）"
            features={[
              '請求書の作成が無制限',
              '適格請求書（インボイス）対応',
              'PDFのダウンロード',
              '顧客管理',
              'いつでも解約可能',
            ]}
            highlighted
            available={isBillingConfigured}
            action={startCheckoutAction}
          />
          <PlanCard
            kind="lifetime"
            title="買い切りプラン"
            price="¥19,800"
            cadence="/ 一括（税込）"
            features={[
              '請求書の作成が無制限',
              '適格請求書（インボイス）対応',
              'PDFのダウンロード',
              '顧客管理',
              '更新手続き不要',
            ]}
            available={isBillingConfigured}
            action={startCheckoutAction}
          />
        </div>
      )}

      <p className="mt-6 text-xs text-ink-400">
        お支払いはStripeの決済ページで行われます。カード情報が当サービスのサーバーに送信・保存されることはありません。
      </p>
    </>
  );
}
