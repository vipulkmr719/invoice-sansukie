import { afterAll, describe, expect, it } from 'vitest';

import { invoiceSchema, invoiceItemSchema } from '@/validation/invoice';
import { clientSchema } from '@/validation/client';
import { companySchema } from '@/validation/company';
import { loginSchema, registerSchema } from '@/validation/auth';
import { escapeHtml, html, nl2br } from '@/lib/html';
import { renderInvoiceHtml } from '@/server/pdf/invoice-template';
import { prisma } from '@/server/db/prisma';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import {
  createClientForUser,
  getClientForUser,
  listClientsForUser,
} from '@/server/db/clients';
import { upsertCompanyForUser, getCompanyForUser } from '@/server/db/companies';
import {
  MAX_ADDRESS_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
} from '@/domain/limits';
import type { InvoiceDetailDTO } from '@/server/db/types';

/**
 * Input security across every user-controlled field.
 *
 * The design this suite verifies: **validation does not try to sanitise.** A
 * company may legitimately be called "A < B Ltd", and a description may contain
 * an apostrophe, so rejecting those characters would break real users while
 * doing nothing for security. Instead every value is stored verbatim as data
 * and neutralised at the boundary it crosses:
 *
 *   - into HTML  -> escaped by the `html` tagged template
 *   - into SQL   -> parameterised by Prisma; no string ever becomes SQL
 *   - into React -> escaped by React
 *
 * Each attack class below therefore checks two things: that a hostile value
 * survives as *text* where it should, and that it never becomes *code*.
 *
 * Unicode payloads are written as escape sequences so this file itself contains
 * no control characters.
 */

// ---------------------------------------------------------------------------
// Payload corpus
// ---------------------------------------------------------------------------

const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg/onload=alert(1)>',
  'javascript:alert(1)',
  '<iframe src="javascript:alert(1)">',
  '"><script>alert(document.cookie)</script>',
  "'-alert(1)-'",
  '<body onload=alert(1)>',
  '<details open ontoggle=alert(1)>',
  '<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>',
] as const;

const HTML_INJECTION_PAYLOADS = [
  '<h1>injected heading</h1>',
  '<form action="https://evil.test"><input name="card"></form>',
  '<a href="https://evil.test">click</a>',
  '<meta http-equiv="refresh" content="0;url=https://evil.test">',
  '<base href="https://evil.test/">',
  '<link rel=stylesheet href="https://evil.test/x.css">',
  '</td></tr><tr><td>row injection',
  '<!-- comment --><div>block</div>',
] as const;

const SQL_INJECTION_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE invoices; --",
  "1' UNION SELECT * FROM users --",
  "admin'--",
  "' OR 1=1 --",
  "\\'; DELETE FROM clients WHERE '1'='1",
  "'; UPDATE billing SET plan='lifetime' WHERE '1'='1",
  '1; SELECT pg_sleep(10)--',
  "') OR ('1'='1",
] as const;

const TEMPLATE_INJECTION_PAYLOADS = [
  '{{7*7}}',
  '${7*7}',
  '#{7*7}',
  '<%= 7*7 %>',
  '{{constructor.constructor("alert(1)")()}}',
  '${process.env.DATABASE_URL}',
  '${global.process.mainModule.require("child_process").execSync("id")}',
  '{{#with "s" as |string|}}{{/with}}',
  '@{7*7}',
] as const;

/**
 * Unicode that has historically broken parsers. Escape sequences only, so the
 * source file stays free of control characters.
 */
const MALFORMED_UNICODE_PAYLOADS = [
  '\uD800', // lone high surrogate
  '\uDFFF', // lone low surrogate
  '\uD800\uD800', // two high surrogates in a row
  'A\u{1F600}B', // valid astral pair: must be accepted
  '\uFEFF byte order mark',
  'a\u202Eevil\u202Ctxt', // bidi override
  '\u200B\u200C\u200D', // zero-width characters
  'é'.repeat(200), // combining marks
  '� replacement',
  '\u0085 next line', // C1 control
] as const;

/** NUL is separate: PostgreSQL text columns cannot store it at all. */
const NUL_PAYLOAD = 'before\u0000after';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLIENT_ID = 'clh1234567890abcdefghijk';

function baseInvoice(overrides: Record<string, unknown> = {}) {
  return {
    issuerName: 'Invoice KK',
    issuerAddress: 'Tokyo Shibuya 2-2-2',
    issuerPhone: '03-5555-0123',
    issuerEmail: 'billing@example.com',
    issuerRegistrationNumber: 'T9234567890123',
    clientId: CLIENT_ID,
    clientName: 'Sample Corp',
    clientAddress: 'Tokyo Chiyoda 1-1',
    clientEmail: 'taro@example.com',
    invoiceNumber: 'INV-2026-0001',
    issueDate: '2026-09-01',
    dueDate: '2026-09-30',
    notes: '',
    items: [
      { description: 'consulting', quantity: 1, unitPrice: 100000, taxRate: 10 },
    ],
    ...overrides,
  };
}

/** Invoice text fields that accept free-form user input. */
const FREE_TEXT_INVOICE_FIELDS = [
  'issuerName',
  'issuerAddress',
  'clientName',
  'clientAddress',
  'notes',
] as const;

function countTags(markup: string): number {
  return (markup.match(/<[a-zA-Z][^>]*>/g) ?? []).length;
}

/** An invoice carrying the same value in every renderable field. */
function invoiceWith(value: string): InvoiceDetailDTO {
  return {
    id: 'inv_1',
    invoiceNumber: 'INV-2026-0001',
    issueDate: '2026-09-01',
    dueDate: '2026-09-30',
    subtotal: 100_000,
    tax8: 0,
    tax10: 10_000,
    total: 110_000,
    clientId: 'cl_1',
    clientName: value,
    clientCompanyName: value,
    notes: value,
    createdAt: '2026-09-01T00:00:00.000Z',
    client: {
      id: 'cl_1',
      name: value,
      companyName: value,
      address: value,
      email: 'a@example.com',
      phone: '03-0000-0000',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    parties: {
      issuer: {
        name: value,
        address: value,
        phone: value,
        email: value,
        registrationNumber: 'T9234567890123',
      },
      billTo: { name: value, address: value, email: value },
    },
    items: [
      {
        id: 'it_1',
        description: value,
        quantity: 1,
        unitPrice: 100_000,
        taxRate: 10,
        amount: 100_000,
      },
    ],
  };
}

const createdUserIds: string[] = [];

async function createUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `input-sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
      passwordHash: await hashPassword('Passw0rd-test'),
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  return user.id;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// XSS and HTML injection
// ---------------------------------------------------------------------------

describe('XSS / HTML injection', () => {
  const ALL_HTML_PAYLOADS = [...XSS_PAYLOADS, ...HTML_INJECTION_PAYLOADS];

  it.each(ALL_HTML_PAYLOADS)('%o is kept as text, not rejected', (payload) => {
    // Validation is not the XSS control; escaping at render time is.
    const result = invoiceSchema.safeParse(baseInvoice({ clientName: payload }));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.clientName).toBe(payload.trim());
  });

  it.each(ALL_HTML_PAYLOADS)('%o creates no HTML element in the PDF', (payload) => {
    const control = renderInvoiceHtml(invoiceWith('BENIGN'));
    const injected = renderInvoiceHtml(invoiceWith(payload));

    // Same document, same element count — an injected tag would add one.
    // This, not substring matching, is the oracle: a payload with no HTML
    // metacharacters (`javascript:alert(1)`) is correctly left unchanged by
    // escaping and appears verbatim as inert text.
    expect(countTags(injected)).toBe(countTags(control));
    expect(injected).not.toMatch(
      /<script|<iframe|<object|<embed|<svg|<img|<link|<base|<form|<meta http-equiv/i,
    );
    expect(injected).not.toMatch(/\son\w+\s*=\s*["']?[a-z]/i);

    // A payload containing markup characters must not survive verbatim.
    if (/[<>"'`=/&]/.test(payload)) {
      expect(injected).not.toContain(payload);
    }
  });

  it('never places user data inside an href or src attribute', () => {
    // `javascript:` is only dangerous in a URL position. The template has no
    // URL-valued attribute at all, which is why it cannot become one.
    const markup = renderInvoiceHtml(invoiceWith('javascript:alert(1)'));

    expect(markup).not.toMatch(/href\s*=/i);
    expect(markup).not.toMatch(/src\s*=/i);
    expect(markup).not.toMatch(/<a[\s>]/i);
  });

  it.each(ALL_HTML_PAYLOADS)('%o is escaped by the html tagged template', (payload) => {
    const output = html`<td>${payload}</td>`.value;

    expect(output).not.toContain('<script');
    expect(countTags(output)).toBe(1); // only the <td> the template wrote

    // Only payloads with markup characters are altered; one without them is
    // already inert and passes through unchanged, which is correct.
    if (/[<>"'`=/&]/.test(payload)) {
      expect(output.replace(/^<td>|<\/td>$/g, '')).not.toContain(payload);
    }
  });

  it('escapes a payload placed in every field at once', () => {
    const markup = renderInvoiceHtml(invoiceWith('<script>alert(1)</script>'));
    expect(markup).not.toContain('<script>alert');
    expect(markup).toContain('&lt;script&gt;');
  });

  it('preserves newlines without letting a tag through', () => {
    expect(nl2br('a\n<script>x</script>').value).toBe(
      'a<br>&lt;script&gt;x&lt;&#47;script&gt;',
    );
  });
});

// ---------------------------------------------------------------------------
// SQL injection
// ---------------------------------------------------------------------------

describe('SQL injection', () => {
  it.each(SQL_INJECTION_PAYLOADS)(
    '%o in a text field is stored literally',
    async (payload) => {
      const userId = await createUser();

      const created = await createClientForUser(userId, {
        name: payload,
        companyName: payload,
        address: payload,
        email: null,
        phone: null,
      });

      // Round-trips byte for byte: it was a parameter, never SQL.
      const reopened = await getClientForUser(userId, created.id);
      expect(reopened?.name).toBe(payload);
      expect(reopened?.companyName).toBe(payload);

      // The tables it tried to drop are still there.
      expect(await prisma.invoice.count({ where: { userId } })).toBe(0);
      expect(await prisma.client.count({ where: { userId } })).toBe(1);
    },
    30_000,
  );

  it.each(SQL_INJECTION_PAYLOADS)(
    '%o as an id matches nothing and errors nothing',
    async (payload) => {
      const userId = await createUser();
      await expect(getClientForUser(userId, payload)).resolves.toBeNull();
    },
    30_000,
  );

  it('rejects an injection-shaped id at the validation layer too', () => {
    for (const payload of SQL_INJECTION_PAYLOADS) {
      expect(invoiceSchema.safeParse(baseInvoice({ clientId: payload })).success).toBe(
        false,
      );
    }
  });

  it('leaves every table intact after all payloads', async () => {
    const usersBefore = await prisma.user.count();
    const userId = await createUser();

    for (const payload of SQL_INJECTION_PAYLOADS) {
      await createClientForUser(userId, {
        name: payload,
        companyName: null,
        address: null,
        email: null,
        phone: null,
      });
    }

    // +1 for the user this test created; nothing was deleted.
    expect(await prisma.user.count()).toBe(usersBefore + 1);
    expect((await listClientsForUser(userId)).length).toBe(
      SQL_INJECTION_PAYLOADS.length,
    );
  }, 30_000);

  it('an injection payload cannot grant a paid plan', async () => {
    const userId = await createUser();

    await createClientForUser(userId, {
      name: "'; UPDATE billing SET plan='lifetime'; --",
      companyName: null,
      address: null,
      email: null,
      phone: null,
    });

    expect(await prisma.billing.count({ where: { userId } })).toBe(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Template injection
// ---------------------------------------------------------------------------

describe('template injection', () => {
  it.each(TEMPLATE_INJECTION_PAYLOADS)('%o is never evaluated', (payload) => {
    const markup = renderInvoiceHtml(invoiceWith(payload));

    // The expression appears as literal text, never its result.
    expect(markup).not.toContain('49');
    expect(markup).not.toContain('postgres');
    expect(markup).not.toMatch(/uid=\d+/);
  });

  it('does not interpolate an environment variable reference', () => {
    const markup = renderInvoiceHtml(invoiceWith('${process.env.DATABASE_URL}'));

    expect(markup).not.toContain('postgresql://');
    expect(markup).not.toContain('devpassword');
    // The literal text survives, escaped.
    expect(markup).toContain('process.env.DATABASE_URL');
  });

  it('the html tagged template interpolates values, never re-parses them', () => {
    // Braces are not HTML-special, so they pass through unchanged — and are
    // never evaluated, because the output is emitted, not re-parsed.
    const output = html`<p>${'${alert(1)}'}</p>`.value;
    expect(output).toBe('<p>${alert(1)}</p>');

    // A second pass over the same value changes nothing either.
    expect(html`<p>${output}</p>`.value).toContain('&lt;p&gt;');
  });
});

// ---------------------------------------------------------------------------
// Oversized input
// ---------------------------------------------------------------------------

describe('oversized input', () => {
  const HUGE = 'a'.repeat(100_000);

  it.each(FREE_TEXT_INVOICE_FIELDS)('rejects a 100k-character %s', (field) => {
    expect(invoiceSchema.safeParse(baseInvoice({ [field]: HUGE })).success).toBe(false);
  });

  it('rejects an oversized item description', () => {
    expect(
      invoiceItemSchema.safeParse({
        description: HUGE,
        quantity: 1,
        unitPrice: 1000,
        taxRate: 10,
      }).success,
    ).toBe(false);
  });

  it('enforces each field at its documented limit, not one character more', () => {
    expect(
      invoiceSchema.safeParse(baseInvoice({ clientName: 'a'.repeat(MAX_NAME_LENGTH) }))
        .success,
    ).toBe(true);
    expect(
      invoiceSchema.safeParse(
        baseInvoice({ clientName: 'a'.repeat(MAX_NAME_LENGTH + 1) }),
      ).success,
    ).toBe(false);

    expect(
      invoiceSchema.safeParse(
        baseInvoice({ clientAddress: 'a'.repeat(MAX_ADDRESS_LENGTH) }),
      ).success,
    ).toBe(true);
    expect(
      invoiceSchema.safeParse(
        baseInvoice({ clientAddress: 'a'.repeat(MAX_ADDRESS_LENGTH + 1) }),
      ).success,
    ).toBe(false);

    expect(
      invoiceSchema.safeParse(baseInvoice({ notes: 'a'.repeat(MAX_NOTES_LENGTH) }))
        .success,
    ).toBe(true);
    expect(
      invoiceSchema.safeParse(baseInvoice({ notes: 'a'.repeat(MAX_NOTES_LENGTH + 1) }))
        .success,
    ).toBe(false);
  });

  it('rejects an invoice with far too many line items', () => {
    const items = Array.from({ length: 5_000 }, () => ({
      description: 'x',
      quantity: 1,
      unitPrice: 1,
      taxRate: 10,
    }));
    expect(invoiceSchema.safeParse(baseInvoice({ items })).success).toBe(false);
  });

  it('rejects oversized credentials', () => {
    expect(
      registerSchema.safeParse({
        email: `${'a'.repeat(300)}@example.test`,
        password: 'Passw0rd12',
        confirmPassword: 'Passw0rd12',
      }).success,
    ).toBe(false);

    expect(
      loginSchema.safeParse({ email: 'a@b.test', password: 'x'.repeat(10_000) }).success,
    ).toBe(false);
  });

  it('rejects oversized company and client fields', () => {
    const company = {
      name: 'Sample Corp',
      address: 'Tokyo',
      phone: '03-1234-5678',
      email: 'a@example.test',
      registrationNumber: 'T9234567890123',
    };

    expect(companySchema.safeParse({ ...company, name: HUGE }).success).toBe(false);
    expect(companySchema.safeParse({ ...company, address: HUGE }).success).toBe(false);
    expect(clientSchema.safeParse({ name: HUGE }).success).toBe(false);
    expect(clientSchema.safeParse({ name: 'ok', address: HUGE }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Malformed Unicode
// ---------------------------------------------------------------------------

describe('malformed Unicode', () => {
  it.each(MALFORMED_UNICODE_PAYLOADS)('handles %j without throwing', (payload) => {
    // Validation must never crash on input; it may accept or reject.
    expect(() =>
      invoiceSchema.safeParse(baseInvoice({ clientName: payload })),
    ).not.toThrow();
    expect(() => escapeHtml(payload)).not.toThrow();
    expect(() => renderInvoiceHtml(invoiceWith(payload))).not.toThrow();
  });

  it('accepts legitimate astral-plane characters (emoji, rare kanji)', () => {
    for (const value of ['A\u{1F600}B', '\u{20BB7}', '\u{20BB7} noodles']) {
      expect(invoiceSchema.safeParse(baseInvoice({ clientName: value })).success).toBe(
        true,
      );
    }
  });

  it('stores and returns astral characters unchanged through the database', async () => {
    const userId = await createUser();
    const name = '\u{20BB7} \u{1F3EF} test';

    const created = await createClientForUser(userId, {
      name,
      companyName: null,
      address: null,
      email: null,
      phone: null,
    });

    expect((await getClientForUser(userId, created.id))?.name).toBe(name);
  }, 30_000);

  it('fails loudly on a NUL byte rather than silently truncating', async () => {
    const userId = await createUser();

    // PostgreSQL text cannot hold U+0000. What matters is that the write is
    // refused, not that half the value is stored.
    await expect(
      createClientForUser(userId, {
        name: NUL_PAYLOAD,
        companyName: null,
        address: null,
        email: null,
        phone: null,
      }),
    ).rejects.toThrow();

    expect(await prisma.client.count({ where: { userId } })).toBe(0);
  }, 30_000);

  it('escapes a lone surrogate without producing broken markup', () => {
    const markup = renderInvoiceHtml(invoiceWith('\uD800'));

    expect(markup).toMatch(/^<!doctype html>/i);
    expect(countTags(markup)).toBe(countTags(renderInvoiceHtml(invoiceWith('BENIGN'))));
  });

  it('does not let a bidi override smuggle markup past escaping', () => {
    const markup = renderInvoiceHtml(
      invoiceWith('\u202E<script>alert(1)</script>\u202C'),
    );

    expect(markup).not.toContain('<script>');
    expect(markup).toContain('&lt;script&gt;');
  });

  it('normalises passwords so a Unicode variant is not a second password', async () => {
    // NFC and NFD spellings of the same string must authenticate identically,
    // or a user typing on a different OS cannot sign in.
    const composed = 'passwörd123';
    const decomposed = 'passwörd123';

    const stored = await hashPassword(composed);
    await expect(verifyPassword(decomposed, stored)).resolves.toBe(true);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Stored-then-rendered round trip
// ---------------------------------------------------------------------------

describe('stored XSS round trip', () => {
  it('a payload stored in the database renders inert', async () => {
    const userId = await createUser();
    const payload = '<img src=x onerror=alert(1)>';

    await upsertCompanyForUser(userId, {
      name: payload,
      address: payload,
      phone: '03-1234-5678',
      email: 'a@example.test',
      registrationNumber: 'T9234567890123',
    });

    const company = await getCompanyForUser(userId);
    expect(company?.name).toBe(payload);

    const markup = renderInvoiceHtml(invoiceWith(company!.name));
    expect(markup).not.toMatch(/<img/i);
    expect(markup).toContain('&lt;img');
  }, 30_000);
});
