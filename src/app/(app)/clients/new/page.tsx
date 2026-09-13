import { ClientForm } from '@/components/clients/ClientForm';
import { PageHeader } from '@/components/layout/PageHeader';
import { createClientAction } from '@/server/actions/clients';
import { requireUser } from '@/server/auth/guard';

export const metadata = { title: '顧客を追加' };

export default async function NewClientPage() {
  await requireUser();

  return (
    <>
      <PageHeader
        title="顧客を追加"
        description="請求先となる取引先の情報を登録します。"
      />
      <ClientForm action={createClientAction} />
    </>
  );
}
