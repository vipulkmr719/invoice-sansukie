import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

const CONTROL =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 ' +
  'placeholder:text-ink-400 transition-colors ' +
  'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ' +
  'disabled:bg-ink-50 disabled:text-ink-400 ' +
  'aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-red-500/20';

export function FieldError({ id, messages }: { id: string; messages?: string[] }) {
  if (!messages || messages.length === 0) return null;

  return (
    <ul id={id} className="mt-1.5 space-y-0.5 text-xs text-red-600">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  required?: boolean;
  errors?: string[];
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  hint,
  required,
  errors,
  children,
  className,
}: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-700">
        {label}
        {required ? (
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ml-1.5 text-xs font-normal text-ink-400">任意</span>
        )}
      </label>
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
      <div className="mt-1.5">{children}</div>
      <FieldError id={`${htmlFor}-error`} messages={errors} />
    </div>
  );
}

export function TextInput({
  className,
  invalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(CONTROL, className)}
      aria-invalid={invalid ? 'true' : undefined}
      {...props}
    />
  );
}

export function TextArea({
  className,
  invalid,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(CONTROL, 'min-h-24 resize-y', className)}
      aria-invalid={invalid ? 'true' : undefined}
      {...props}
    />
  );
}

export function Select({
  className,
  invalid,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      className={cn(CONTROL, 'appearance-none bg-no-repeat pr-9', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20' fill='none' stroke='%236b7688' stroke-width='1.6'%3E%3Cpath d='M6 8l4 4 4-4'/%3E%3C/svg%3E\")",
        backgroundPosition: 'right 0.6rem center',
        backgroundSize: '1.1rem',
      }}
      aria-invalid={invalid ? 'true' : undefined}
      {...props}
    >
      {children}
    </select>
  );
}
