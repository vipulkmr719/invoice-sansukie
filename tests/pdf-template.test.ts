import { describe, expect, it } from 'vitest';

import { renderInvoiceHtml, invoicePdfFilename } from '@/server/pdf/invoice-template';
import type { InvoiceDetailDTO } from '@/server/db/types';

import { XSS_PAYLOADS } from './html-escaping.test';

function buildInvoice(overrides: Partial<InvoiceDetailDTO> = {}): InvoiceDetailDTO {
  return {
    id: 'inv_1',
    invoiceNumber: 'INV-2026-0001',
    issueDate: '2026-09-01',
    dueDate: '2026-09-30',
    subtotal: 104_500,
    tax8: 360,
    tax10: 10_000,
    total: 114_860,
    clientId: 'cl_1',
    clientName: '山田 太郎',
    clientCompanyName: '株式会社サンプル',
    notes: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    client: {
      id: 'cl_1',
      name: '山田 太郎',
      companyName: '株式会社サンプル',
      address: '〒100-0001\n東京都千代田区千代田1-1',
      email: 'taro@example.com',
      phone: '03-1234-5678',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    parties: {
      issuer: {
        name: '株式会社インボイス',
        address: '〒150-0001\n東京都渋谷区神宮前2-2-2',
        phone: '03-5555-0123',
        email: 'billing@example.com',
        registrationNumber: 'T9234567890123',
      },
      billTo: {
        name: '株式会社サンプル',
        address: '〒100-0001\n東京都千代田区千代田1-1',
        email: 'taro@example.com',
      },
    },
    items: [
      {
        id: 'it_1',
        description: '制作費',
        quantity: 1,
        unitPrice: 100_000,
        taxRate: 10,
        amount: 100_000,
      },
      {
        id: 'it_2',
        description: '書籍（軽減税率）',
        quantity: 3,
        unitPrice: 1_500,
        taxRate: 8,
        amount: 4_500,
      },
    ],
    ...overrides,
  };
}

/** Every opening tag in a document. */
function countTags(markup: string): number {
  return (markup.match(/<[a-zA-Z][^>]*>/g) ?? []).length;
}

/**
 * The oracle for "did this payload become markup?".
 *
 * Rendering the same invoice twice — once with the payload, once with a benign
 * control string — must produce the same number of HTML elements. An injected
 * payload necessarily adds at least one tag, so any difference is a breach.
 *
 * Substring checks are not enough on their own: an escaped `javascript:` or
 * `onerror` still appears in the output as inert *text*, which is correct
 * behaviour, not a finding.
 */
const CONTROL_VALUE = 'BENIGN';

function expectNoInjectedMarkup(withPayload: string, control: string, payload: string) {
  expect(
    countTags(withPayload),
    'payload introduced HTML elements into the document',
  ).toBe(countTags(control));

  // A payload containing markup characters must never appear verbatim.
  if (/[<>"'`=/&]/.test(payload)) {
    expect(withPayload, 'payload survived unescaped').not.toContain(payload);
  }

  // Escaped output carries no live event handler or tag opening.
  expect(withPayload).not.toMatch(/\son\w+\s*=\s*["']?[a-z]/i);
}

/** Markers the template itself never emits, checked on every render. */
function expectTemplateStaysInert(markup: string) {
  expect(markup).not.toMatch(/<script/i);
  expect(markup).not.toMatch(/<iframe/i);
  expect(markup).not.toMatch(/<object|<embed|<svg|<img|<link/i);
  expect(markup).not.toMatch(/<meta\s+http-equiv/i);
}

describe('適格請求書 PDF テンプレート', () => {
  it('renders every required 記載事項', () => {
    const markup = renderInvoiceHtml(buildInvoice({ notes: '振込先：○○銀行' }));

    // ① 発行者 + 登録番号
    expect(markup).toContain('株式会社インボイス');
    expect(markup).toContain('T9234-5678-90123');
    expect(markup).toContain('東京都渋谷区神宮前2-2-2');
    expect(markup).toContain('03-5555-0123');
    expect(markup).toContain('billing@example.com');
    // ② 取引年月日
    expect(markup).toContain('2026年9月1日');
    expect(markup).toContain('2026年9月30日');
    // ③ 取引内容 + 軽減税率の表示
    expect(markup).toContain('制作費');
    expect(markup).toContain('書籍（軽減税率）');
    expect(markup).toContain('※');
    // ④⑤ 税率ごとの対価と消費税額
    expect(markup).toContain('8%対象');
    expect(markup).toContain('10%対象');
    expect(markup).toContain('8%（軽減）');
    // ⑥ 交付を受ける事業者
    expect(markup).toContain('株式会社サンプル');
    expect(markup).toContain('御中');
    // 請求書番号 / 合計 / 備考
    expect(markup).toContain('INV-2026-0001');
    expect(markup).toContain('振込先：○○銀行');
  });

  it('is a self-contained document with no external references', () => {
    const markup = renderInvoiceHtml(buildInvoice());

    expect(markup).toMatch(/^<!doctype html>/i);
    expect(markup).toContain('lang="ja"');
    expect(markup).toContain('charset="utf-8"');
    // No remote stylesheet, script, font or image fetches.
    expect(markup).not.toMatch(/https?:\/\//);
    expect(markup).not.toContain('<script');
  });

  it('shows per-rate subtotals that reconcile with the stored totals', () => {
    const markup = renderInvoiceHtml(buildInvoice());

    expect(markup).toContain('￥100,000'); // 10%対象
    expect(markup).toContain('￥4,500'); //   8%対象
    expect(markup).toContain('￥10,000'); //  10%消費税
    expect(markup).toContain('￥360'); //      8%消費税
    expect(markup).toContain('￥114,860'); // 合計
  });

  it('omits a rate block entirely when nothing is taxed at it', () => {
    const markup = renderInvoiceHtml(
      buildInvoice({
        subtotal: 100_000,
        tax8: 0,
        tax10: 10_000,
        total: 110_000,
        items: [
          {
            id: 'it_1',
            description: '制作費',
            quantity: 1,
            unitPrice: 100_000,
            taxRate: 10,
            amount: 100_000,
          },
        ],
      }),
    );

    expect(markup).toContain('10%対象');
    expect(markup).not.toContain('8%対象');
    expect(markup).not.toContain('※');
  });

  it('renders a notice instead of an issuer when none was recorded', () => {
    const invoice = buildInvoice();
    const markup = renderInvoiceHtml({
      ...invoice,
      parties: { ...invoice.parties, issuer: null },
    });

    expect(markup).toContain('発行者情報が登録されていません');
    expect(markup).not.toContain('株式会社インボイス');
  });
});

function renderWithBillTo(field: 'name' | 'address' | 'email', value: string) {
  const invoice = buildInvoice();
  return renderInvoiceHtml({
    ...invoice,
    parties: {
      ...invoice.parties,
      billTo: { ...invoice.parties.billTo, [field]: value },
    },
  });
}

function renderWithIssuer(field: 'name' | 'address', value: string) {
  const invoice = buildInvoice();
  return renderInvoiceHtml({
    ...invoice,
    parties: {
      ...invoice.parties,
      issuer: { ...invoice.parties.issuer!, [field]: value },
    },
  });
}

describe('XSS: 請求先名 (client name)', () => {
  it.each(XSS_PAYLOADS)('escapes %o in the bill-to name', (payload) => {
    const markup = renderWithBillTo('name', payload);
    const control = renderWithBillTo('name', CONTROL_VALUE);

    expectNoInjectedMarkup(markup, control, payload);
    expectTemplateStaysInert(markup);
  });

  it('keeps the payload visible as escaped text so nothing is silently dropped', () => {
    const markup = renderWithBillTo('name', '<script>alert(1)</script>');
    expect(markup).toContain('&lt;script&gt;');
  });
});

describe('XSS: 住所 (address)', () => {
  it.each(XSS_PAYLOADS)('escapes %o in the bill-to address', (payload) => {
    const markup = renderWithBillTo('address', payload);
    const control = renderWithBillTo('address', CONTROL_VALUE);

    expectNoInjectedMarkup(markup, control, payload);
    expectTemplateStaysInert(markup);
  });

  it.each(XSS_PAYLOADS)('escapes %o in the issuer address', (payload) => {
    const markup = renderWithIssuer('address', payload);
    const control = renderWithIssuer('address', CONTROL_VALUE);

    expectNoInjectedMarkup(markup, control, payload);
    expectTemplateStaysInert(markup);
  });

  it('keeps newlines as <br> without letting a tag through', () => {
    const markup = renderWithBillTo(
      'address',
      '〒100-0001\n<script>alert(1)</script>',
    );

    expect(markup).toContain('〒100-0001<br>');
    expectTemplateStaysInert(markup);
    // Exactly one extra tag — the <br> the newline legitimately produced.
    expect(countTags(markup)).toBe(
      countTags(renderWithBillTo('address', CONTROL_VALUE)) + 1,
    );
  });
});

describe('XSS: 品目 (item description)', () => {
  const renderWithDescription = (description: string) => {
    const invoice = buildInvoice();
    return renderInvoiceHtml({
      ...invoice,
      items: [{ ...invoice.items[0]!, description }],
    });
  };

  it.each(XSS_PAYLOADS)('escapes %o in a line item description', (payload) => {
    const markup = renderWithDescription(payload);
    const control = renderWithDescription(CONTROL_VALUE);

    expectNoInjectedMarkup(markup, control, payload);
    expectTemplateStaysInert(markup);
  });

  it('still prints the description as readable text', () => {
    const markup = renderWithDescription('<img src=x onerror=alert(1)>');
    expect(markup).toContain('&lt;img src&#61;x onerror&#61;alert(1)&gt;');
  });
});

describe('XSS: その他のフィールド', () => {
  it.each(XSS_PAYLOADS)('escapes %o in the issuer name', (payload) => {
    expectNoInjectedMarkup(
      renderWithIssuer('name', payload),
      renderWithIssuer('name', CONTROL_VALUE),
      payload,
    );
  });

  it.each(XSS_PAYLOADS)('escapes %o in the notes', (payload) => {
    expectNoInjectedMarkup(
      renderInvoiceHtml(buildInvoice({ notes: payload })),
      renderInvoiceHtml(buildInvoice({ notes: CONTROL_VALUE })),
      payload,
    );
  });

  it.each(XSS_PAYLOADS)('escapes %o in the invoice number', (payload) => {
    expectNoInjectedMarkup(
      renderInvoiceHtml(buildInvoice({ invoiceNumber: payload })),
      renderInvoiceHtml(buildInvoice({ invoiceNumber: CONTROL_VALUE })),
      payload,
    );
  });

  it.each(XSS_PAYLOADS)('escapes %o in an email address', (payload) => {
    expectNoInjectedMarkup(
      renderWithBillTo('email', payload),
      renderWithBillTo('email', CONTROL_VALUE),
      payload,
    );
  });

  it('escapes a payload that tries to break out of the <title> element', () => {
    const markup = renderInvoiceHtml(
      buildInvoice({ invoiceNumber: '</title><script>alert(1)</script>' }),
    );
    expectTemplateStaysInert(markup);
    expect(markup).not.toContain('</title><script>');
  });

  it('escapes a payload aimed at the <style> block', () => {
    const markup = renderWithIssuer(
      'name',
      '</style><script>alert(1)</script><style>',
    );
    expectTemplateStaysInert(markup);
    expect(markup).not.toContain('</style><script>');
  });
});

describe('invoicePdfFilename', () => {
  it('builds a filename from the invoice number', () => {
    expect(invoicePdfFilename('INV-2026-0001')).toBe('invoice-INV-2026-0001.pdf');
  });

  it('strips characters that could break the Content-Disposition header', () => {
    expect(invoicePdfFilename('A"; rm -rf /; x="')).not.toMatch(/["\s;/]/);
    // 請求書 (3 chars) + CR + LF collapse to 5 underscores; ':' and ' ' to two
    // more. Nothing that could inject a second header survives.
    expect(invoicePdfFilename('請求書\r\nX-Injected: 1')).toBe(
      'invoice-_____X-Injected__1.pdf',
    );
  });
});
