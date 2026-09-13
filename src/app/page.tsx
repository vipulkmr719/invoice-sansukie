import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Logo } from '@/components/layout/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { getCurrentUser } from '@/server/auth/guard';

export const metadata = {
  title: 'インボイス作成 | 適格請求書に対応した請求書作成サービス',
};

const FEATURES = [
  {
    title: '税率ごとの自動計算',
    body: '8%（軽減税率）と10%（標準税率）を明細ごとに指定すると、税率区分ごとの対価の額と消費税額を自動で集計します。端数処理は税率ごとに1回だけ行います。',
  },
  {
    title: '登録番号の記載と検証',
    body: '適格請求書発行事業者登録番号を設定に保存すると、すべての請求書に自動で記載されます。「T」+13桁の形式とチェックデジットを入力時に検証します。',
  },
  {
    title: '顧客情報の管理',
    body: '取引先を登録しておけば、請求書作成時に選ぶだけ。請求実績も顧客ごとに集計して確認できます。',
  },
  {
    title: 'PDFで保存・送付',
    body: '作成した請求書はそのままの体裁でPDFとして保存できます。印刷レイアウトはA4に最適化されています。',
  },
];

const STEPS = [
  { step: '01', title: '自社情報を登録', body: '会社名・住所・登録番号を設定画面で一度だけ入力します。' },
  { step: '02', title: '顧客を追加', body: '請求先の宛名や会社名、住所を登録します。' },
  { step: '03', title: '請求書を作成', body: '明細と税率を入力すると、消費税額と合計が自動で計算されます。' },
];

export default async function LandingPage() {
  // Someone already signed in has no use for the marketing page.
  const user = await getCurrentUser();
  if (user) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-ink-200/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Logo />
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900"
            >
              ログイン
            </Link>
            <ButtonLink href="/register" size="sm">
              無料で始める
            </ButtonLink>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20 lg:px-8 lg:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <span className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
                適格請求書等保存方式に対応
              </span>
              <h1 className="mt-5 text-3xl leading-tight font-bold tracking-tight text-ink-900 sm:text-4xl lg:text-5xl">
                インボイス対応の請求書を、
                <br className="hidden sm:block" />
                迷わず正確に。
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-600">
                8%と10%の税率区分、登録番号の記載、税率ごとの端数処理。
                インボイス制度で求められる記載事項を満たした請求書を、入力するだけで作成できます。
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/register">無料で始める</ButtonLink>
                <ButtonLink href="/login" variant="secondary">
                  ログイン
                </ButtonLink>
              </div>
              <p className="mt-4 text-xs text-ink-400">
                クレジットカードの登録は不要です。
              </p>
            </div>

            {/* Decorative invoice preview — illustrative layout, not stored data. */}
            <div aria-hidden="true" className="relative">
              <div className="rounded-2xl border border-ink-200/70 bg-white p-6 shadow-xl shadow-ink-900/[0.06] sm:p-8">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="h-2.5 w-24 rounded-full bg-ink-800" />
                    <div className="mt-2 h-2 w-16 rounded-full bg-ink-200" />
                  </div>
                  <div className="text-right">
                    <div className="ml-auto h-2 w-20 rounded-full bg-ink-200" />
                    <div className="mt-2 ml-auto h-2 w-14 rounded-full bg-ink-200" />
                  </div>
                </div>
                <div className="mt-8 space-y-3">
                  {[68, 52, 60].map((width, index) => (
                    <div key={index} className="flex items-center justify-between gap-4">
                      <div className="h-2 rounded-full bg-ink-100" style={{ width: `${width}%` }} />
                      <div className="h-2 w-12 shrink-0 rounded-full bg-ink-100" />
                    </div>
                  ))}
                </div>
                <div className="mt-8 space-y-2.5 border-t border-ink-200/70 pt-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-ink-400">10%対象</span>
                    <div className="h-2 w-16 rounded-full bg-ink-200" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-ink-400">8%対象</span>
                    <div className="h-2 w-16 rounded-full bg-ink-200" />
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-sm font-semibold text-ink-800">合計</span>
                    <div className="h-3 w-24 rounded-full bg-brand-600" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="border-y border-ink-200/70 bg-ink-50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
            <h2 className="text-center text-2xl font-bold tracking-tight text-ink-900">
              請求書業務に必要な機能を、ひとまとめに
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-xl border border-ink-200/70 bg-white p-6"
                >
                  <h3 className="text-base font-semibold text-ink-900">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-600">
                    {feature.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Steps */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <h2 className="text-center text-2xl font-bold tracking-tight text-ink-900">
            3ステップではじめられます
          </h2>
          <ol className="mt-10 grid gap-6 sm:grid-cols-3">
            {STEPS.map((item) => (
              <li key={item.step}>
                <span className="text-sm font-bold text-brand-600">{item.step}</span>
                <h3 className="mt-2 text-base font-semibold text-ink-900">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
                  {item.body}
                </p>
              </li>
            ))}
          </ol>
          <div className="mt-12 text-center">
            <ButtonLink href="/register">アカウントを作成する</ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-200/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <Logo />
          <p>
            © {new Date().getFullYear()} インボイス作成. 本サービスは税務助言を提供するものではありません。
          </p>
        </div>
      </footer>
    </div>
  );
}
