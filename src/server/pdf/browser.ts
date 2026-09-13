import 'server-only';

import type { Browser, LaunchOptions } from 'puppeteer';

import { env } from '@/lib/env';

/**
 * Headless browser used to turn the invoice template into a PDF.
 *
 * Launching Chrome costs roughly a second, so one instance is kept for the
 * lifetime of the process and each request gets its own page (and its own
 * isolated browser context, see `renderPdf`). The instance is recreated
 * automatically if it ever disconnects — a crashed renderer must not take the
 * route down permanently.
 *
 * Hardening notes on the launch flags:
 *   --no-sandbox               required in most container images, which do not
 *                              grant the kernel namespaces Chrome's sandbox
 *                              needs. Acceptable here only because the page is
 *                              built entirely from our own escaped template and
 *                              never loads remote content — see `renderPdf`.
 *   --disable-dev-shm-usage    /dev/shm is tiny in containers; without this,
 *                              Chrome crashes on larger documents.
 *   --disable-extensions,
 *   --disable-background-*     nothing but our page should ever run.
 */

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--no-first-run',
  '--no-default-browser-check',
  '--font-render-hinting=none',
];

let browserPromise: Promise<Browser> | null = null;

async function launch(): Promise<Browser> {
  // Imported lazily so `next build` does not pull Chrome into every route's
  // module graph, and so a deployment that never renders a PDF never pays for
  // loading puppeteer.
  const puppeteer = (await import('puppeteer')).default;

  const options: LaunchOptions = {
    headless: true,
    args: LAUNCH_ARGS,
    // Deployments that supply their own Chrome (most container images do) set
    // PDF_CHROME_PATH; otherwise puppeteer's bundled build is used.
    ...(env.PDF_CHROME_PATH ? { executablePath: env.PDF_CHROME_PATH } : {}),
  };

  const browser = await puppeteer.launch(options);

  browser.once('disconnected', () => {
    // Drop the cached promise so the next request launches a fresh instance.
    browserPromise = null;
  });

  return browser;
}

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch().catch((error: unknown) => {
      // Never cache a failed launch — the next request should retry.
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

/** Close the shared browser. Used by tests and graceful shutdown. */
export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;

  if (!pending) return;

  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // Already gone; nothing to clean up.
  }
}
