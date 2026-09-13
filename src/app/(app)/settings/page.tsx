import { CompanyForm } from '@/components/settings/CompanyForm';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { formatJapaneseDate } from '@/lib/date';
import { saveCompanyAction } from '@/server/actions/company';
import { requireUser } from '@/server/auth/guard';
import { getCompanyForUser } from '@/server/db/companies';
import { findUserById } from '@/server/db/users';

export const metadata = { title: '設定' };

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const user = await requireUser();
  const [company, account, params] = await Promise.all([
    getCompanyForUser(user.id),
    findUserById(user.id),
    searchParams,
  ]);

  return (
    <>
      <PageHeader
        title="設定"
        description="自社情報とアカウントを管理します。"
      />

      {params.welcome ? (
        <Alert tone="info" className="mb-6">
          アカウントを作成しました。まず自社情報を登録すると、請求書に登録番号が記載されます。
        </Alert>
      ) : null}

      <CompanyForm company={company} action={saveCompanyAction} />

      <Card className="mt-6">
        <CardHeader title="アカウント" />
        <CardBody>
          <dl className="space-y-3 text-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <dt className="text-ink-500">メールアドレス</dt>
              <dd className="font-medium text-ink-900">{user.email}</dd>
            </div>
            {account ? (
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <dt className="text-ink-500">登録日</dt>
                <dd className="tabular font-medium text-ink-900">
                  {formatJapaneseDate(account.createdAt)}
                </dd>
              </div>
            ) : null}
          </dl>
        </CardBody>
      </Card>
    </>
  );
}
