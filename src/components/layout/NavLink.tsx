'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function NavLink({
  href,
  icon,
  children,
  onNavigate,
}: {
  href: string;
  icon: ReactNode;
  children: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-brand-50 text-brand-700'
          : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-brand-600' : 'text-ink-400')}>
        {icon}
      </span>
      {children}
    </Link>
  );
}
