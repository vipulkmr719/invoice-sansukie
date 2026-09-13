import 'server-only';

import { formatNumber, formatYen } from '@/domain/money';
import { TAX_RATE_REDUCED, taxRateLabel } from '@/domain/tax';
import { formatRegistrationNumber } from '@/domain/registration-number';
import { formatJapaneseDate } from '@/lib/date';
import { html, nl2br, unsafeRawHtml, type SafeHtml } from '@/lib/html';
import type { InvoiceDetailDTO } from '@/server/db/types';

/**
 * 適格請求書 (qualified invoice) HTML template used for PDF generation.
 *
 * SAFETY: every value that originates from a user reaches the page through the
 * `html` tagged template, which HTML-escapes it. The only unescaped markup is
 * the stylesheet below, which is a constant written in this file. There is no
 * string concatenation of user input into markup anywhere in this module.
 *
 * The layout satisfies the記載事項 required of a qualified invoice:
 *   ① 発行者の氏名・名称 と 登録番号
 *   ② 取引年月日
 *   ③ 取引内容（軽減税率対象である旨を含む）
 *   ④ 税率ごとに区分して合計した対価の額 と 適用税率
 *   ⑤ 税率ごとに区分した消費税額
 *   ⑥ 交付を受ける事業者の氏名・名称
 */

/** Developer-authored stylesheet. Contains no interpolated values. */
const STYLESHEET = unsafeRawHtml(`
  @page { size: A4; margin: 14mm; }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #2a303b;
    /* IPAGothic ships with the render container; the rest are fallbacks for
       other deployment images. Puppeteer subsets and embeds whichever is used,
       so the PDF renders identically on machines without Japanese fonts. */
    font-family: "IPAPGothic", "IPAGothic", "Noto Sans CJK JP", "Noto Sans JP",
                 "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;
    font-size: 10.5pt;
    line-height: 1.65;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .sheet { width: 100%; }

  h1.title {
    margin: 0 0 18px;
    text-align: center;
    font-size: 20pt;
    font-weight: 700;
    letter-spacing: 0.4em;
    text-indent: 0.4em;
  }

  .meta { text-align: right; font-size: 9.5pt; color: #525b6b; }
  .meta div { margin-top: 2px; }

  .parties {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    margin-top: 22px;
  }
  .parties > div { width: 48%; }
  .issuer { text-align: right; }

  .label { font-size: 8.5pt; color: #8d97ab; margin-bottom: 4px; }

  .billto-name {
    font-size: 14pt;
    font-weight: 700;
    border-bottom: 1px solid #b6bdcb;
    padding-bottom: 4px;
    margin-bottom: 6px;
  }
  .billto-name .honorific { font-size: 10pt; font-weight: 400; margin-left: 4px; }

  .issuer-name { font-size: 12pt; font-weight: 700; }
  .issuer p { margin: 2px 0; font-size: 9.5pt; color: #525b6b; }
  .issuer .registration {
    margin-top: 8px;
    font-size: 10pt;
    font-weight: 600;
    color: #2a303b;
  }

  .billto p { margin: 2px 0; font-size: 9.5pt; color: #525b6b; }

  .amount-box {
    margin-top: 24px;
    background: #f6f7f9;
    border-radius: 6px;
    padding: 14px 18px;
  }
  .amount-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .amount-label { font-size: 10pt; font-weight: 600; color: #525b6b; }
  .amount-value { font-size: 18pt; font-weight: 700; }
  .amount-due { text-align: right; font-size: 9pt; color: #6b7688; margin-top: 2px; }

  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-top: 26px;
    font-size: 9.5pt;
  }
  table.items thead th {
    border-top: 1px solid #d9dde5;
    border-bottom: 1px solid #d9dde5;
    padding: 7px 6px;
    font-size: 8.5pt;
    font-weight: 500;
    color: #6b7688;
    text-align: left;
  }
  table.items tbody td {
    border-bottom: 1px solid #eceef2;
    padding: 9px 6px;
    vertical-align: top;
  }
  table.items tbody tr { page-break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .center { text-align: center; white-space: nowrap; }
  .reduced-mark { color: #6b7688; margin-left: 3px; }

  .footnote { margin-top: 8px; font-size: 8.5pt; color: #6b7688; }

  .totals { margin-top: 24px; display: flex; justify-content: flex-end; }
  .totals table { border-collapse: collapse; min-width: 280px; font-size: 9.5pt; }
  .totals td { padding: 4px 0; }
  .totals td.value {
    text-align: right;
    padding-left: 24px;
    font-variant-numeric: tabular-nums;
  }
  .totals tr.grand td {
    border-top: 1px solid #b6bdcb;
    padding-top: 8px;
    font-weight: 700;
    font-size: 12pt;
  }
  .totals .breakdown { color: #6b7688; }

  .notes {
    margin-top: 26px;
    border-top: 1px solid #d9dde5;
    padding-top: 12px;
    page-break-inside: avoid;
  }
  .notes .body { margin-top: 6px; font-size: 9.5pt; color: #3e4553; }

  .no-issuer {
    margin-top: 26px;
    padding: 10px 12px;
    border: 1px solid #fed7aa;
    background: #fff7ed;
    border-radius: 6px;
    font-size: 9pt;
    color: #b45309;
  }
`);

function renderItemRows(invoice: InvoiceDetailDTO): SafeHtml[] {
  return invoice.items.map(
    (item) => html`
      <tr>
        <td>
          ${item.description}${item.taxRate === TAX_RATE_REDUCED
            ? html`<span class="reduced-mark">※</span>`
            : ''}
        </td>
        <td class="num">${formatNumber(item.quantity)}</td>
        <td class="num">${formatNumber(item.unitPrice)}</td>
        <td class="center">${taxRateLabel(item.taxRate)}</td>
        <td class="num">${formatYen(item.amount)}</td>
      </tr>
    `,
  );
}

/**
 * Render one invoice as a standalone HTML document.
 *
 * The output is self-contained: no external stylesheet, script, font or image
 * request. Puppeteer therefore needs no network access to produce the PDF, and
 * nothing on the page can reach out to an attacker-controlled host.
 */
export function renderInvoiceHtml(invoice: InvoiceDetailDTO): string {
  const { issuer, billTo } = invoice.parties;

  const hasReducedRate = invoice.items.some(
    (item) => item.taxRate === TAX_RATE_REDUCED,
  );

  // 税率ごとの対価の額, derived from the stored line amounts so the printed
  // breakdown always reconciles with the persisted totals.
  const subtotal8 = invoice.items
    .filter((item) => item.taxRate === TAX_RATE_REDUCED)
    .reduce((sum, item) => sum + item.amount, 0);
  const subtotal10 = invoice.subtotal - subtotal8;

  const document = html`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>請求書 ${invoice.invoiceNumber}</title>
    <style>${STYLESHEET}</style>
  </head>
  <body>
    <div class="sheet">
      <h1 class="title">請求書</h1>

      <div class="meta">
        <div>請求書番号：${invoice.invoiceNumber}</div>
        <div>発行日：${formatJapaneseDate(invoice.issueDate)}</div>
      </div>

      <div class="parties">
        <div class="billto">
          <div class="label">請求先</div>
          <div class="billto-name">
            ${billTo.name}<span class="honorific">御中</span>
          </div>
          ${billTo.address ? html`<p>${nl2br(billTo.address)}</p>` : ''}
          ${billTo.email ? html`<p>${billTo.email}</p>` : ''}
        </div>

        <div class="issuer">
          ${issuer
            ? html`
                <div class="issuer-name">${issuer.name}</div>
                <p>${nl2br(issuer.address)}</p>
                ${issuer.phone ? html`<p>TEL: ${issuer.phone}</p>` : ''}
                ${issuer.email ? html`<p>${issuer.email}</p>` : ''}
                <div class="registration">
                  登録番号：${formatRegistrationNumber(issuer.registrationNumber)}
                </div>
              `
            : ''}
        </div>
      </div>

      ${issuer
        ? ''
        : html`<div class="no-issuer">
            発行者情報が登録されていません。設定画面から自社情報を登録してください。
          </div>`}

      <div class="amount-box">
        <div class="amount-row">
          <span class="amount-label">ご請求金額（税込）</span>
          <span class="amount-value">${formatYen(invoice.total)}</span>
        </div>
        <div class="amount-due">
          お支払期限：${formatJapaneseDate(invoice.dueDate)}
        </div>
      </div>

      <table class="items">
        <thead>
          <tr>
            <th>品目</th>
            <th class="num">数量</th>
            <th class="num">単価</th>
            <th class="center">税率</th>
            <th class="num">金額（税抜）</th>
          </tr>
        </thead>
        <tbody>
          ${renderItemRows(invoice)}
        </tbody>
      </table>

      ${hasReducedRate
        ? html`<p class="footnote">※ は軽減税率（8%）対象品目です。</p>`
        : ''}

      <div class="totals">
        <table>
          <tbody>
            <tr>
              <td>小計（税抜）</td>
              <td class="value">${formatYen(invoice.subtotal)}</td>
            </tr>
            ${subtotal8 > 0
              ? html`
                  <tr class="breakdown">
                    <td>8%対象　${formatYen(subtotal8)}</td>
                    <td class="value">消費税　${formatYen(invoice.tax8)}</td>
                  </tr>
                `
              : ''}
            ${subtotal10 > 0
              ? html`
                  <tr class="breakdown">
                    <td>10%対象　${formatYen(subtotal10)}</td>
                    <td class="value">消費税　${formatYen(invoice.tax10)}</td>
                  </tr>
                `
              : ''}
            <tr class="grand">
              <td>合計（税込）</td>
              <td class="value">${formatYen(invoice.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      ${invoice.notes
        ? html`
            <div class="notes">
              <div class="label">備考</div>
              <div class="body">${nl2br(invoice.notes)}</div>
            </div>
          `
        : ''}
    </div>
  </body>
</html>`;

  return document.value;
}

/** Filename for the downloaded PDF, e.g. `invoice-INV-2026-0001.pdf`. */
export function invoicePdfFilename(invoiceNumber: string): string {
  // Restrict to characters that are safe in a Content-Disposition filename.
  const safe = invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '_');
  return `invoice-${safe}.pdf`;
}
