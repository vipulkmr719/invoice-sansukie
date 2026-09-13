'use client';

import { useFormStatus } from 'react-dom';

import { Button } from './Button';

/**
 * A submit button that disables itself while its form's action is in flight —
 * which is also what prevents a double-submit from creating two invoices.
 */
export function SubmitButton({
  children,
  pendingLabel = '保存中…',
  variant = 'primary',
  className,
}: {
  children: string;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} disabled={pending} className={className}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
