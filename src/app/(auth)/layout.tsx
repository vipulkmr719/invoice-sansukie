import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Logo } from '@/components/layout/Logo';
import { getCurrentUser } from '@/server/auth/guard';

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // An already-authenticated visitor has no reason to see the login form.
  const user = await getCurrentUser();
  if (user) {
    redirect('/dashboard');
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="px-4 py-5 sm:px-6">
        <Link href="/" className="inline-flex">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center sm:px-6">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
