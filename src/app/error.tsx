'use client';

import { useEffect } from 'react';

/**
 * Global error boundary.
 *
 * `error.message` is deliberately not rendered: in production Next.js replaces
 * it with a digest, but in development it can carry a stack trace or a
 * connection string. Users see a fixed sentence; the detail stays in the
 * server log (security requirement #10).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/error]', error.digest ?? 'no-digest');
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-bold text-ink-900">
        エラーが発生しました
      </h1>
      <p className="mt-2 max-w-md text-sm text-ink-500">
        処理中に問題が発生しました。しばらくしてからもう一度お試しください。
      </p>
      {error.digest ? (
        <p className="mt-3 text-xs text-ink-400">
          エラーID: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
      >
        再試行する
      </button>
    </div>
  );
}
