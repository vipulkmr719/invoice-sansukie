import { AppShell } from '@/components/layout/AppShell';
import { logoutAction } from '@/server/actions/auth';
import { requireUser } from '@/server/auth/guard';

/**
 * Every authenticated route sits under this layout, so `requireUser()` is the
 * single gate in front of all of them. Data fetching in the pages below can
 * assume a signed-in user exists.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <AppShell email={user.email} logoutAction={logoutAction}>
      {children}
    </AppShell>
  );
}
