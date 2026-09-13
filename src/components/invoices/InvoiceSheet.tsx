import type { InvoiceDetailDTO } from '@/server/db/types';
import { formatRegistrationNumber } from '@/domain/registration-number';
import { formatNumber, formatYen } from '@/domain/money';
import { formatJapaneseDate } from '@/lib/date';
import { TAX_RATE_REDUCED, taxRateLabel } from '@/domain/tax';

/**
 * The printable invoice itself — 適格請求書 layout.
 *
 * Under the invoice system a qualified invoice must show: the issuer's name and
 * registration number, the transaction date, a description of the goods or
 * services (marked when the reduced rate applies), the tax-exclusive total
 * *per tax rate*, the tax amount per rate, and the recipient's name. Every one
 * of those has a place below.
 */
export function InvoiceSheet({ invoice }: { invoice: InvoiceDetailDTO }) {
  // The parties come from the invoice's own snapshot (falling back to the live
  // company record for invoices issued before snapshots existed), so this
  // preview shows exactly what the generated PDF will show.
  const { issuer, billTo } = invoice.parties;

  const hasReducedRate = invoice.items.some((item) => item.taxRate === TAX_RATE_REDUCED);

  // 税率ごとの対価の額 — derived from the stored line amounts, so the printed
  // breakdown always reconciles with the persisted totals.
  const subtotal8 = invoice.items
    .filter((item) => item.taxRate === TAX_RATE_REDUCED)
    .reduce((sum, item) => sum + item.amount, 0);
  const subtotal10 = invoice.subtotal - subtotal8;

  return (
    <article className="print-sheet mx-auto max-w-3xl rounded-xl border border-ink-200/70 bg-white p-6 shadow-sm sm:p-10">
      <header className="border-b border-ink-200 pb-6">
        <h1 className="text-center text-xl font-bold tracking-[0.3em] text-ink-900 sm:text-2xl">
          請求書
        </h1>
        <p className="tabular mt-4 text-right text-sm text-ink-500">
          請求書番号：{invoice.invoiceNumber}
        </p>
        <p className="tabular text-right text-sm text-ink-500">
          発行日：{formatJapaneseDate(invoice.issueDate)}
        </p>
      </header>

      <div className="mt-6 grid gap-8 sm:grid-cols-2">
        {/* 請求先 */}
        <div>
          <p className="text-xs font-medium text-ink-400">請求先</p>
          <p className="mt-2 border-b border-ink-300 pb-1.5 text-lg font-semibold text-ink-900">
            {billTo.name}
            <span className="ml-1 text-sm font-normal">御中</span>
          </p>
          {billTo.address ? (
            <p className="mt-1.5 text-sm whitespace-pre-line text-ink-600">
              {billTo.address}
            </p>
          ) : null}
          {billTo.email ? (
            <p className="mt-1 text-sm text-ink-600">{billTo.email}</p>
          ) : null}
        </div>

        {/* 発行者 */}
        <div className="sm:text-right">
          {issuer ? (
            <>
              <p className="text-base font-semibold text-ink-900">{issuer.name}</p>
              <p className="mt-1.5 text-sm whitespace-pre-line text-ink-600">
                {issuer.address}
              </p>
              {issuer.phone ? (
                <p className="tabular mt-1 text-sm text-ink-600">TEL: {issuer.phone}</p>
              ) : null}
              {issuer.email ? (
                <p className="mt-0.5 text-sm text-ink-600">{issuer.email}</p>
              ) : null}
              <p className="tabular mt-2 text-sm font-medium text-ink-800">
                登録番号：{formatRegistrationNumber(issuer.registrationNumber)}
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-400">
              発行者情報が登録されていません。設定画面から登録してください。
            </p>
          )}
        </div>
      </div>

      {/* 請求金額 */}
      <div className="print-break-avoid mt-8 rounded-lg bg-ink-50 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-ink-600">ご請求金額（税込）</span>
          <span className="tabular text-2xl font-bold text-ink-900">
            {formatYen(invoice.total)}
          </span>
        </div>
        <p className="tabular mt-1 text-right text-xs text-ink-500">
          お支払期限：{formatJapaneseDate(invoice.dueDate)}
        </p>
      </div>

      {/* 明細 */}
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-y border-ink-200 text-xs text-ink-500">
              <th scope="col" className="py-2.5 pr-3 text-left font-medium">品目</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">数量</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">単価</th>
              <th scope="col" className="px-3 py-2.5 text-center font-medium">税率</th>
              <th scope="col" className="py-2.5 pl-3 text-right font-medium">金額（税抜）</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-200/70">
            {invoice.items.map((item) => (
              <tr key={item.id} className="print-break-avoid">
                <td className="py-3 pr-3 text-ink-800">
                  {item.description}
                  {item.taxRate === TAX_RATE_REDUCED ? (
                    <span className="ml-1 text-ink-500" aria-label="軽減税率対象">
                      ※
                    </span>
                  ) : null}
                </td>
                <td className="tabular px-3 py-3 text-right whitespace-nowrap text-ink-700">
                  {formatNumber(item.quantity)}
                </td>
                <td className="tabular px-3 py-3 text-right whitespace-nowrap text-ink-700">
                  {formatNumber(item.unitPrice)}
                </td>
                <td className="tabular px-3 py-3 text-center whitespace-nowrap text-ink-600">
                  {taxRateLabel(item.taxRate)}
                </td>
                <td className="tabular py-3 pl-3 text-right font-medium whitespace-nowrap text-ink-900">
                  {formatYen(item.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasReducedRate ? (
        <p className="mt-3 text-xs text-ink-500">※ は軽減税率（8%）対象品目です。</p>
      ) : null}

      {/* 税率ごとの内訳 — required by the invoice system */}
      <div className="print-break-avoid mt-8 flex justify-end">
        <dl className="w-full max-w-sm space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-600">小計（税抜）</dt>
            <dd className="tabular font-medium text-ink-900">{formatYen(invoice.subtotal)}</dd>
          </div>

          {subtotal8 > 0 ? (
            <div className="flex justify-between text-ink-600">
              <dt>8%対象</dt>
              <dd className="tabular">
                {formatYen(subtotal8)}
                <span className="ml-2 text-ink-500">消費税 {formatYen(invoice.tax8)}</span>
              </dd>
            </div>
          ) : null}

          {subtotal10 > 0 ? (
            <div className="flex justify-between text-ink-600">
              <dt>10%対象</dt>
              <dd className="tabular">
                {formatYen(subtotal10)}
                <span className="ml-2 text-ink-500">消費税 {formatYen(invoice.tax10)}</span>
              </dd>
            </div>
          ) : null}

          <div className="flex justify-between border-t border-ink-300 pt-2.5">
            <dt className="font-semibold text-ink-900">合計（税込）</dt>
            <dd className="tabular text-lg font-bold text-ink-900">
              {formatYen(invoice.total)}
            </dd>
          </div>
        </dl>
      </div>

      {invoice.notes ? (
        <div className="print-break-avoid mt-8 border-t border-ink-200 pt-5">
          <p className="text-xs font-medium text-ink-400">備考</p>
          <p className="mt-2 text-sm whitespace-pre-line text-ink-700">{invoice.notes}</p>
        </div>
      ) : null}
    </article>
  );
}
