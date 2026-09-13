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

  async function handleLogout() {
    'use server';
    await logoutAction();
  }

  return (
    <AppShell email={user.email} logoutAction={handleLogout}>
      {children}
    </AppShell>
  );
}
