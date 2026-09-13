import { afterAll, describe, expect, it } from 'vitest';

import { renderInvoiceHtml } from '@/server/pdf/invoice-template';
import { renderInvoicePdf } from '@/server/pdf/render';
import { closeBrowser, getBrowser } from '@/server/pdf/browser';
import type { InvoiceDetailDTO } from '@/server/db/types';

/**
 * End-to-end verification of the PDF pipeline against hostile input.
 *
 * The template tests prove the *markup* is escaped. These tests go further and
 * put the rendered document into a real browser to prove that:
 *
 *   - the payload produced no elements — it is text and nothing else;
 *   - no script runs, even with JavaScript deliberately switched ON, because
 *     there is no executable node in the document to run;
 *   - a real PDF comes out, with the Japanese font embedded.
 */

const PAYLOAD = '<script>window.__xssExecuted = true;</script>';
const IMG_PAYLOAD = '<img src=x onerror="window.__xssExecuted = true">';
const SVG_PAYLOAD = '<svg onload="window.__xssExecuted = true"></svg>';

function buildInvoice(overrides: Partial<InvoiceDetailDTO> = {}): InvoiceDetailDTO {
  return {
    id: 'inv_sec',
    invoiceNumber: 'INV-2026-9999',
    issueDate: '2026-09-01',
    dueDate: '2026-09-30',
    subtotal: 100_000,
    tax8: 0,
    tax10: 10_000,
    total: 110_000,
    clientId: 'cl_sec',
    clientName: '検証 太郎',
    clientCompanyName: '検証株式会社',
    notes: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    client: {
      id: 'cl_sec',
      name: '検証 太郎',
      companyName: '検証株式会社',
      address: '東京都',
      email: 'a@example.com',
      phone: '03-0000-0000',
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
      billTo: { name: '検証株式会社', address: '東京都', email: 'a@example.com' },
    },
    items: [
      {
        id: 'it_sec',
        description: '制作費',
        quantity: 1,
        unitPrice: 100_000,
        taxRate: 10,
        amount: 100_000,
      },
    ],
    ...overrides,
  };
}

function withPayloadEverywhere(payload: string): InvoiceDetailDTO {
  const invoice = buildInvoice();
  return {
    ...invoice,
    invoiceNumber: `INV-${payload}`,
    notes: payload,
    parties: {
      issuer: {
        name: payload,
        address: payload,
        phone: payload,
        email: payload,
        registrationNumber: 'T9234567890123',
      },
      billTo: { name: payload, address: payload, email: payload },
    },
    items: [{ ...invoice.items[0]!, description: payload }],
  };
}

/**
 * Load markup in a real page **with scripting enabled** and report what the
 * browser actually built. Scripting is on deliberately: the production renderer
 * turns it off, and this asserts the document is inert even without that.
 */
async function inspectInBrowser(markup: string) {
  const browser = await getBrowser();
  const context = await browser.createBrowserContext();

  try {
    const page = await context.newPage();
    await page.setJavaScriptEnabled(true);

    // Block every outbound request so an injected <img src=http://…> cannot
    // reach the network even if one somehow got through.
    const attemptedUrls: string[] = [];
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        void request.continue();
        return;
      }
      attemptedUrls.push(request.url());
      void request.abort();
    });

    await page.setContent(markup, { waitUntil: 'load' });
    // Give any onerror/onload handler a chance to fire before we look.
    await new Promise((resolve) => setTimeout(resolve, 250));

    return {
      ...(await page.evaluate(() => ({
        xssExecuted: Boolean((window as unknown as { __xssExecuted?: boolean }).__xssExecuted),
        scripts: document.querySelectorAll('script').length,
        iframes: document.querySelectorAll('iframe').length,
        images: document.querySelectorAll('img').length,
        svgs: document.querySelectorAll('svg').length,
        objects: document.querySelectorAll('object, embed').length,
        links: document.querySelectorAll('link').length,
        metaRefresh: document.querySelectorAll('meta[http-equiv]').length,
        anchors: document.querySelectorAll('a').length,
        inlineHandlers: [...document.querySelectorAll('*')].filter((el) =>
          [...el.attributes].some((attr) => attr.name.startsWith('on')),
        ).length,
        bodyText: document.body.innerText,
      }))),
      attemptedUrls,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

afterAll(async () => {
  await closeBrowser();
});

describe('PDF パイプラインの XSS 耐性', () => {
  it.each([
    ['script tag', PAYLOAD],
    ['img onerror', IMG_PAYLOAD],
    ['svg onload', SVG_PAYLOAD],
  ])(
    'renders a %s payload as inert text in every field',
    async (_label, payload) => {
      const markup = renderInvoiceHtml(withPayloadEverywhere(payload));
      const result = await inspectInBrowser(markup);

      // Nothing ran, even with scripting enabled.
      expect(result.xssExecuted).toBe(false);

      // The payload created no elements at all.
      expect(result.scripts).toBe(0);
      expect(result.iframes).toBe(0);
      expect(result.images).toBe(0);
      expect(result.svgs).toBe(0);
      expect(result.objects).toBe(0);
      expect(result.links).toBe(0);
      expect(result.metaRefresh).toBe(0);
      expect(result.anchors).toBe(0);
      expect(result.inlineHandlers).toBe(0);

      // Nothing tried to phone home.
      expect(result.attemptedUrls).toEqual([]);

      // …and the payload is visible to a reader as literal text.
      expect(result.bodyText).toContain(payload);
    },
    60_000,
  );

  it(
    'blocks subresource requests during a normal render',
    async () => {
      // A benign invoice must also make zero outbound requests: the template is
      // fully self-contained, which is what closes the SSRF path.
      const markup = renderInvoiceHtml(buildInvoice());
      const result = await inspectInBrowser(markup);

      expect(result.attemptedUrls).toEqual([]);
      expect(result.scripts).toBe(0);
    },
    60_000,
  );
});

describe('PDF 生成', () => {
  it(
    'produces a valid PDF with the Japanese font embedded',
    async () => {
      const { pdf, html } = await renderInvoicePdf(buildInvoice());

      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pdf.byteLength).toBeGreaterThan(5_000);

      // A CJK font subset must be embedded, or the PDF would show tofu on a
      // machine without Japanese fonts installed.
      const raw = pdf.toString('latin1');
      const fonts = [...raw.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)].map(
        (match) => match[1] ?? '',
      );
      expect(fonts.length).toBeGreaterThan(0);
      expect(fonts.join(' ')).toMatch(/Gothic|Noto|CJK|Mincho|Sans/i);

      // The source document carried the Japanese content it was built from.
      expect(html).toContain('請求書');
      expect(html).toContain('株式会社インボイス');
      expect(html).toContain('T9234-5678-90123');
    },
    60_000,
  );

  it(
    'still produces a PDF when every field carries a hostile payload',
    async () => {
      const { pdf } = await renderInvoicePdf(withPayloadEverywhere(PAYLOAD));

      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pdf.byteLength).toBeGreaterThan(1_000);
    },
    60_000,
  );
});
