/**
 * HTTP security headers.
 *
 * The policy below was derived from what this application actually serves, not
 * copied from a template: the built pages emit two inline `<script>` blocks
 * (Next's hydration bootstrap), no inline `<style>` blocks, and reference no
 * external host. Everything else is therefore denied.
 */

export interface SecurityHeaderOptions {
  /** Per-request nonce, so inline scripts need no 'unsafe-inline'. */
  nonce: string;
  /**
   * Whether this deployment is served over TLS — see `lib/transport.ts`.
   *
   * Gates the two directives that are actively harmful without HTTPS in
   * front: `Strict-Transport-Security` (meaningless over plain HTTP, and a
   * foot-gun if it ever reaches a browser on a hostname reused for dev) and
   * `upgrade-insecure-requests` (would rewrite this app's own requests to a
   * scheme nothing is listening on). The same signal drives Secure cookies,
   * so the two can never disagree.
   */
  isSecureTransport: boolean;
}

/**
 * Build the Content-Security-Policy.
 *
 * Notes on the choices that are easy to get wrong:
 *
 * - `default-src 'none'` means every fetch type must be listed explicitly. A
 *   directive we forget fails closed rather than silently inheriting `'self'`.
 *
 * - `script-src` uses a per-request nonce plus `'strict-dynamic'`. Next.js
 *   reads the nonce out of this header and stamps it onto the scripts it
 *   injects; `'strict-dynamic'` then lets those trusted scripts load the chunk
 *   files they need without listing every hashed filename.
 *
 * - `style-src-attr 'unsafe-inline'` is set separately from `style-src`. The
 *   app sets a handful of inline `style=` attributes (chart bar heights, the
 *   select arrow) which CSP treats as inline styles. Allowing them via
 *   `style-src-attr` keeps `style-src` itself strict, so an injected
 *   `<style>` block is still refused — a far more useful boundary than
 *   loosening both.
 *
 * - `img-src` includes `data:` for the select control's inline SVG arrow.
 *
 * - `frame-ancestors 'none'` is the modern clickjacking control;
 *   X-Frame-Options is sent alongside for older agents.
 *
 * - `form-action 'self'` — Stripe Checkout is reached by a server-side
 *   redirect, not a cross-origin form post, so Stripe does not belong here.
 *
 * - `upgrade-insecure-requests` is added in production only; in development
 *   over plain HTTP it would break every local request.
 */
export function buildContentSecurityPolicy({
  nonce,
  isSecureTransport,
}: SecurityHeaderOptions): string {
  const directives: string[] = [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ];

  if (isSecureTransport) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

/**
 * Headers applied to every response, alongside the CSP.
 *
 * HSTS is sent only on HTTPS deployments, and is deliberate about its values:
 * two years, subdomains included, and `preload`. Sending it from a plain-HTTP
 * origin would pin that hostname to HTTPS in the developer's browser and break
 * the dev server for as long as the max-age lasts.
 */
export function buildSecurityHeaders({
  nonce,
  isSecureTransport,
}: SecurityHeaderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Security-Policy': buildContentSecurityPolicy({ nonce, isSecureTransport }),

    // Never let a browser guess a response's type — the defence against a
    // stored file being sniffed into an executable type.
    'X-Content-Type-Options': 'nosniff',

    // Clickjacking. frame-ancestors above is authoritative; this covers agents
    // that do not implement it.
    'X-Frame-Options': 'DENY',

    // Send the full URL only to our own origin, and only the origin
    // cross-site — invoice URLs contain record ids.
    'Referrer-Policy': 'strict-origin-when-cross-origin',

    // Switch off device APIs the application never uses, so an injected
    // script cannot reach them either.
    'Permissions-Policy': [
      'accelerometer=()',
      'autoplay=()',
      'camera=()',
      'display-capture=()',
      'encrypted-media=()',
      'fullscreen=(self)',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()',
    ].join(', '),

    // Keep this origin out of other sites' process, and refuse cross-origin
    // reads of our documents.
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',

    'X-DNS-Prefetch-Control': 'off',
  };

  if (isSecureTransport) {
    headers['Strict-Transport-Security'] =
      'max-age=63072000; includeSubDomains; preload';
  }

  return headers;
}

/** Cryptographically random nonce, base64 as CSP requires. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
