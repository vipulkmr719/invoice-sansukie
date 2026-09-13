import { PageHeader } from '@/components/layout/PageHeader';
import { ButtonLink } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { requireUser } from '@/server/auth/guard';

export const metadata = { title: 'お支払いのキャンセル' };

/**
 * /payment/cancelled — informational only, like its sibling. Reaching it
 * changes nothing; the user simply left Stripe's page without paying.
 */
export default async function PaymentCancelledPage() {
  await requireUser();

  return (
    <>
      <PageHeader title="お支払いはキャンセルされました" />

      <Card>
        <CardBody className="py-10 text-center">
          <h2 className="text-lg font-semibold text-ink-900">
            お支払いは行われていません
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-500">
            プランは変更されていません。無料プランのままご利用いただけます。
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink href="/upgrade">プランを見る</ButtonLink>
            <ButtonLink href="/dashboard" variant="secondary">
              ダッシュボードへ
            </ButtonLink>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
