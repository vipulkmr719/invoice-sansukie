import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function StatCard({
  label,
  value,
  sublabel,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'neutral' | 'brand' | 'warning';
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink-200/70 bg-white p-5 shadow-sm shadow-ink-900/[0.03]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-500">{label}</p>
        {icon ? (
          <span
            aria-hidden="true"
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              tone === 'brand' && 'bg-brand-50 text-brand-600',
              tone === 'warning' && 'bg-accent-50 text-accent-600',
              tone === 'neutral' && 'bg-ink-100 text-ink-500',
            )}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          'tabular mt-3 text-2xl font-bold tracking-tight',
          tone === 'warning' ? 'text-accent-700' : 'text-ink-900',
        )}
      >
        {value}
      </p>
      {sublabel ? <p className="mt-1 text-xs text-ink-400">{sublabel}</p> : null}
    </div>
  );
}
