import { DeleteClientButton } from '@/components/clients/DeleteClientButton';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/Alert';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatYen } from '@/domain/money';
import { deleteClientAction } from '@/server/actions/clients';
import { requireUser } from '@/server/auth/guard';
import { listClientsWithStats } from '@/server/db/clients';

export const metadata = { title: '顧客' };

export const dynamic = 'force-dynamic';

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; deleted?: string }>;
}) {
  const user = await requireUser();
  const [clients, params] = await Promise.all([
    listClientsWithStats(user.id),
    searchParams,
  ]);

  return (
    <>
      <PageHeader
        title="顧客"
        description={clients.length > 0 ? `${clients.length}件の顧客を登録しています。` : undefined}
        action={<ButtonLink href="/clients/new">顧客を追加</ButtonLink>}
      />

      {params.created ? (
        <Alert tone="success" className="mb-6">
          顧客を登録しました。
        </Alert>
      ) : null}
      {params.deleted ? (
        <Alert tone="success" className="mb-6">
          顧客を削除しました。
        </Alert>
      ) : null}

      {clients.length === 0 ? (
        <Card>
          <EmptyState
            title="顧客がまだ登録されていません"
            description="請求書を作成するには、先に請求先の顧客を登録してください。"
            action={<ButtonLink href="/clients/new">顧客を追加</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => (
            <Card key={client.id} className="flex flex-col">
              <div className="flex-1 px-5 py-5">
                <h2 className="text-base font-semibold text-ink-900">
                  {client.companyName ?? client.name}
                </h2>
                {client.companyName ? (
                  <p className="mt-0.5 text-sm text-ink-500">{client.name}</p>
                ) : null}

                <dl className="mt-4 space-y-1.5 text-sm">
                  {client.email ? (
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-ink-400">メール</dt>
                      <dd className="min-w-0 truncate text-ink-600">{client.email}</dd>
                    </div>
                  ) : null}
                  {client.phone ? (
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-ink-400">電話</dt>
                      <dd className="tabular min-w-0 truncate text-ink-600">{client.phone}</dd>
                    </div>
                  ) : null}
                  {client.address ? (
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-ink-400">住所</dt>
                      <dd className="min-w-0 whitespace-pre-line text-ink-600">
                        {client.address}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              <div className="border-t border-ink-200/70 px-5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-ink-500">
                    <span className="tabular font-semibold text-ink-800">
                      {client.invoiceCount}件
                    </span>
                    <span className="mx-1.5 text-ink-300">·</span>
                    <span className="tabular">{formatYen(client.billedTotal)}</span>
                  </div>
                  <DeleteClientButton
                    clientId={client.id}
                    clientName={client.companyName ?? client.name}
                    action={deleteClientAction}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
