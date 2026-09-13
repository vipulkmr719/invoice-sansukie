import Link from 'next/link';

import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { requireUser } from '@/server/auth/guard';
import { getInvoiceQuotaForUser } from '@/server/db/billing';

export const metadata = { title: 'お支払い手続きの完了' };

// Read fresh on every visit: the entitlement shown must be the one the webhook
// has actually written, not a cached copy from before the payment.
export const dynamic = 'force-dynamic';

/**
 * /payment/success — informational ONLY.
 *
 * Reaching this URL grants nothing. There is deliberately no write of any kind
 * on this page: no billing upsert, no entitlement flag, no session mutation.
 * Anyone can type this address, bookmark it, or arrive with a forged
 * `session_id`, and the account's plan will be exactly what it was before.
 *
 * All this page does is *read* the authoritative state — the billing row that
 * the signature-verified Stripe webhook maintains — and describe it. When the
 * webhook has not landed yet (it usually arrives within seconds, but Stripe
 * makes no promise about ordering with the browser redirect) the page says the
 * payment is still being confirmed rather than pretending it succeeded.
 *
 * The `session_id` in the query string is ignored on purpose. Verifying it
 * against Stripe here would be a second, weaker source of truth and would
 * invite exactly the bug this page exists to avoid.
 */
export default async function PaymentSuccessPage() {
  const user = await requireUser();

  // A read. Never a write.
  const quota = await getInvoiceQuotaForUser(user.id);

  return (
    <>
      <PageHeader title="お支払い手続きが完了しました" />

      <Card>
        <CardBody className="py-10 text-center">
          <div
            aria-hidden="true"
            className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m20 6-11 11-5-5" />
            </svg>
          </div>

          {quota.isPro ? (
            <>
              <h2 className="text-lg font-semibold text-ink-900">
                有料プランが有効になりました
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
                請求書を無制限に作成できます。ご利用ありがとうございます。
              </p>
              <div className="mt-3">
                <Badge tone="success">有料プラン 有効</Badge>
              </div>
              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                <ButtonLink href="/invoices/new">請求書を作成</ButtonLink>
                <ButtonLink href="/dashboard" variant="secondary">
                  ダッシュボードへ
                </ButtonLink>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-ink-900">
                お支払いを確認しています
              </h2>
              <p className="mx-auto mt-2 max-w-lg text-sm text-ink-500">
                決済事業者からの確認をお待ちしています。通常は数秒で完了します。
                このページを再読み込みすると最新の状態を確認できます。
              </p>
              <Alert tone="info" className="mx-auto mt-6 max-w-lg text-left">
                プランの反映は決済事業者からの確認をもって行われます。
                このページを開いただけでは有料プランは有効になりません。
              </Alert>
              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                <ButtonLink href="/payment/success">状態を再確認する</ButtonLink>
                <ButtonLink href="/upgrade" variant="secondary">
                  プランの状況を見る
                </ButtonLink>
              </div>
            </>
          )}

          <p className="mt-8 text-xs text-ink-400">
            お困りの場合は{' '}
            <Link href="/settings" className="underline">
              設定
            </Link>{' '}
            からご連絡ください。
          </p>
        </CardBody>
      </Card>
    </>
  );
}
