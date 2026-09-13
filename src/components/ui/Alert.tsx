import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Tone = 'error' | 'success' | 'warning' | 'info';

const TONES: Record<Tone, string> = {
  error: 'border-red-200 bg-red-50 text-red-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-accent-200 bg-accent-50 text-accent-700',
  info: 'border-brand-200 bg-brand-50 text-brand-700',
};

export function Alert({
  tone = 'info',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-lg border px-4 py-3 text-sm', TONES[tone], className)}
    >
      {children}
    </div>
  );
}
