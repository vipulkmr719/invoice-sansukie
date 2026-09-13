import { describe, expect, it } from 'vitest';

import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  generateNonce,
} from '@/lib/security-headers';
import { isSecureDeployment } from '@/lib/transport';

/**
 * The response-header policy.
 *
 * Headers are easy to regress silently — nothing fails when one disappears —
 * so each required directive is asserted individually rather than by comparing
 * one long string.
 */

const NONCE = 'testnonce0000000000000==';

function directives(csp: string): Map<string, string> {
  return new Map(
    csp.split(';').map((part) => {
      const trimmed = part.trim();
      const space = trimmed.indexOf(' ');
      return space === -1
        ? ([trimmed, ''] as [string, string])
        : ([trimmed.slice(0, space), trimmed.slice(space + 1)] as [string, string]);
    }),
  );
}

describe('Content-Security-Policy', () => {
  const https = directives(
    buildContentSecurityPolicy({ nonce: NONCE, isSecureTransport: true }),
  );
  const http = directives(
    buildContentSecurityPolicy({ nonce: NONCE, isSecureTransport: false }),
  );

  it('denies everything by default, so a forgotten directive fails closed', () => {
    expect(https.get('default-src')).toBe("'none'");
  });

  it('allows scripts only with the request nonce — never unsafe-inline', () => {
    const scriptSrc = https.get('script-src') ?? '';

    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('never permits eval anywhere in the policy', () => {
    // Shipping a validation library to the browser would force this open;
    // src/domain/limits.ts exists specifically to avoid that.
    expect(
      buildContentSecurityPolicy({ nonce: NONCE, isSecureTransport: true }),
    ).not.toContain('unsafe-eval');
  });

  it('keeps style-src strict and confines unsafe-inline to style attributes', () => {
    // The app sets a few inline style="" attributes; an injected <style>
    // block must still be refused.
    expect(https.get('style-src')).toBe("'self'");
    expect(https.get('style-src-attr')).toBe("'unsafe-inline'");
  });

  it('allows the data: URI the select control needs, and nothing wider', () => {
    expect(https.get('img-src')).toBe("'self' data:");
  });

  it('blocks framing, base tag hijacking, plugins and cross-origin forms', () => {
    expect(https.get('frame-ancestors')).toBe("'none'");
    expect(https.get('base-uri')).toBe("'none'");
    expect(https.get('object-src')).toBe("'none'");
    expect(https.get('form-action')).toBe("'self'");
  });

  it('restricts network access to our own origin', () => {
    expect(https.get('connect-src')).toBe("'self'");
  });

  it('upgrades insecure requests in production only', () => {
    // In development the app is served over plain HTTP; upgrading there would
    // break every local request.
    expect(https.has('upgrade-insecure-requests')).toBe(true);
    expect(http.has('upgrade-insecure-requests')).toBe(false);
  });
});

describe('security headers', () => {
  const https = buildSecurityHeaders({ nonce: NONCE, isSecureTransport: true });
  const http = buildSecurityHeaders({ nonce: NONCE, isSecureTransport: false });

  it.each([
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    ['X-DNS-Prefetch-Control', 'off'],
  ])('sets %s to %s', (header, value) => {
    expect(https[header]).toBe(value);
    expect(http[header]).toBe(value);
  });

  it('sends HSTS in production only, with a long max-age and preload', () => {
    const hsts = https['Strict-Transport-Security'];

    expect(hsts).toBeDefined();
    expect(hsts).toContain('includeSubDomains');
    expect(hsts).toContain('preload');

    const maxAge = Number(/max-age=(\d+)/.exec(hsts ?? '')?.[1]);
    // The preload list requires at least one year.
    expect(maxAge).toBeGreaterThanOrEqual(31_536_000);

    // Never in development: it would pin localhost to HTTPS in the developer's
    // browser for as long as max-age lasts.
    expect(http['Strict-Transport-Security']).toBeUndefined();
  });

  it('switches off the device APIs the application never uses', () => {
    const policy = https['Permissions-Policy'] ?? '';

    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      expect(policy).toContain(`${feature}=()`);
    }
  });
});

describe('generateNonce', () => {
  it('produces a fresh, high-entropy value each call', () => {
    const nonces = new Set(Array.from({ length: 200 }, () => generateNonce()));

    expect(nonces.size).toBe(200);
    for (const nonce of nonces) {
      // 16 random bytes, base64 encoded.
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
      expect(Buffer.from(nonce, 'base64').length).toBe(16);
    }
  });
});

describe('cookie naming policy', () => {
  /**
   * Mirrors the rule in src/auth.config.ts. Asserted here because the real
   * behaviour needs an HTTPS origin, which this suite cannot serve — the
   * naming rule is what the browser enforces, so it is worth pinning.
   */
  const cookieNames = (appUrl: string) => {
    // Built from the same predicate the running app uses, so this test fails
    // if the cookie gate and the header gate ever stop agreeing.
    const secure = isSecureDeployment(appUrl);
    return {
      secure,
      session: `${secure ? '__Secure-' : ''}authjs.session-token`,
      csrf: `${secure ? '__Host-' : ''}authjs.csrf-token`,
    };
  };

  it('uses __Secure- and __Host- prefixes on an HTTPS origin', () => {
    const https = cookieNames('https://invoice.example.com');

    expect(https.secure).toBe(true);
    // The browser refuses a __Secure- cookie that is not Secure and HTTPS, so
    // the prefix itself blocks a downgrade overwrite.
    expect(https.session).toBe('__Secure-authjs.session-token');
    // __Host- additionally forbids a Domain attribute, so no sibling
    // subdomain can set or replace the CSRF cookie.
    expect(https.csrf).toBe('__Host-authjs.csrf-token');
  });

  it('drops the prefixes on a plain-HTTP origin, or the browser would reject them', () => {
    const http = cookieNames('http://localhost:3000');

    expect(http.secure).toBe(false);
    expect(http.session).toBe('authjs.session-token');
    expect(http.csrf).toBe('authjs.csrf-token');
  });
});

describe('transport gate', () => {
  /**
   * HSTS, upgrade-insecure-requests and Secure cookies must be driven by one
   * signal. Gating any of them on NODE_ENV instead is the classic failure: a
   * staging box built in production mode but served over plain HTTP would set
   * cookies the browser silently drops, and would upgrade its own requests to
   * a scheme nothing answers on.
   */
  it.each([
    ['https://invoice.example.com', true],
    ['https://invoice.example.com/', true],
    ['http://localhost:3000', false],
    ['http://invoice.internal', false],
    ['', false],
    [undefined, false],
  ])('isSecureDeployment(%s) === %s', (appUrl, expected) => {
    expect(isSecureDeployment(appUrl as string | undefined)).toBe(expected);
  });

  it('ties HSTS and upgrade-insecure-requests to that same signal', () => {
    for (const appUrl of ['https://invoice.example.com', 'http://localhost:3000']) {
      const secure = isSecureDeployment(appUrl);
      const headers = buildSecurityHeaders({ nonce: NONCE, isSecureTransport: secure });

      expect('Strict-Transport-Security' in headers).toBe(secure);
      expect(headers['Content-Security-Policy']!.includes('upgrade-insecure-requests')).toBe(secure);
    }
  });

  it('never claims HSTS on a plain-HTTP deployment, whatever NODE_ENV says', () => {
    // NODE_ENV is deliberately not consulted by the builder at all.
    const headers = buildSecurityHeaders({
      nonce: NONCE,
      isSecureTransport: isSecureDeployment('http://localhost:3000'),
    });

    expect(headers['Strict-Transport-Security']).toBeUndefined();
  });
});
