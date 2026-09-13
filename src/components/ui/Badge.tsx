import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'warning' | 'success' | 'brand';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-600',
  warning: 'bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-200',
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  brand: 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
