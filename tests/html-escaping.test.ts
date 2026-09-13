import { describe, expect, it } from 'vitest';

import { escapeHtml, html, nl2br, unsafeRawHtml, SafeHtml } from '@/lib/html';

/** Payloads that must never survive into markup as live HTML. */
export const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><script>alert(document.domain)</script>',
  "'><svg/onload=alert(1)>",
  '<iframe src="javascript:alert(1)"></iframe>',
  '<body onload=alert(1)>',
  '</textarea><script>alert(1)</script>',
  '<a href="javascript:alert(1)">click</a>',
  '<style>@import "http://evil.test/x.css";</style>',
  '<link rel=stylesheet href="http://evil.test/x.css">',
  '<meta http-equiv="refresh" content="0;url=http://evil.test">',
  '<object data="http://evil.test"></object>',
  '{{constructor.constructor("alert(1)")()}}',
  '<div style="background:url(javascript:alert(1))">x</div>',
] as const;

describe('escapeHtml', () => {
  it('escapes the characters that let markup start', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes backtick, equals and slash as well', () => {
    // These close the unquoted-attribute and end-tag injection routes.
    expect(escapeHtml('`')).toBe('&#96;');
    expect(escapeHtml('=')).toBe('&#61;');
    expect(escapeHtml('/')).toBe('&#47;');
  });

  it('renders null and undefined as empty, not as the words', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('leaves Japanese text untouched', () => {
    expect(escapeHtml('株式会社サンプル 御中 ￥1,234')).toBe(
      '株式会社サンプル 御中 ￥1,234',
    );
  });

  it.each(XSS_PAYLOADS)('neutralises %o', (payload) => {
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
  });
});

describe('html tagged template', () => {
  it('escapes interpolated values', () => {
    const name = '<script>alert(1)</script>';
    const output = html`<td>${name}</td>`.value;

    expect(output).toBe('<td>&lt;script&gt;alert(1)&lt;&#47;script&gt;</td>');
    expect(output).not.toContain('<script>');
  });

  it('escapes values interpolated into attributes', () => {
    const evil = '" onload="alert(1)';
    const output = html`<div title="${evil}"></div>`.value;

    expect(output).not.toContain('onload="alert(1)"');
    expect(output).toContain('&quot;');
  });

  it('composes nested SafeHtml without double-escaping', () => {
    const inner = html`<em>${'株式会社 <A>'}</em>`;
    const output = html`<p>${inner}</p>`.value;

    expect(output).toBe('<p><em>株式会社 &lt;A&gt;</em></p>');
    expect(output).not.toContain('&amp;lt;');
  });

  it('renders arrays of SafeHtml in order', () => {
    const rows = ['a', '<b>'].map((value) => html`<li>${value}</li>`);
    expect(html`<ul>${rows}</ul>`.value).toBe('<ul><li>a</li><li>&lt;b&gt;</li></ul>');
  });

  it('returns a SafeHtml instance, not a bare string', () => {
    expect(html`<p>x</p>`).toBeInstanceOf(SafeHtml);
  });
});

describe('nl2br', () => {
  it('converts newlines to <br> and escapes everything else', () => {
    const output = nl2br('〒100-0001\n東京都<script>alert(1)</script>').value;

    expect(output).toContain('<br>');
    expect(output).not.toContain('<script>');
    expect(output).toContain('&lt;script&gt;');
  });

  it('handles CRLF and bare CR', () => {
    expect(nl2br('a\r\nb\rc').value).toBe('a<br>b<br>c');
  });

  it('returns empty for null or empty input', () => {
    expect(nl2br(null).value).toBe('');
    expect(nl2br('').value).toBe('');
  });

  it('cannot be used to smuggle a tag across a newline', () => {
    const output = nl2br('<scr\nipt>alert(1)</scr\nipt>').value;
    expect(output).not.toMatch(/<script/i);
  });
});

describe('unsafeRawHtml', () => {
  it('passes markup through — it is the single audited escape hatch', () => {
    const css = unsafeRawHtml('body { color: red }');
    expect(html`<style>${css}</style>`.value).toBe('<style>body { color: red }</style>');
  });
});
