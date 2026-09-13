import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold text-brand-600">404</p>
      <h1 className="mt-3 text-2xl font-bold text-ink-900">
        ページが見つかりません
      </h1>
      <p className="mt-2 max-w-md text-sm text-ink-500">
        お探しのページは移動または削除された可能性があります。
      </p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
      >
        ダッシュボードへ戻る
      </Link>
    </div>
  );
}
