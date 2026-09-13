/**
 * Safe HTML construction.
 *
 * The PDF template renders user-supplied text — company names, addresses, item
 * descriptions, free-form notes. None of it may be concatenated into markup
 * directly: a client named `<img src=x onerror=alert(1)>` would otherwise
 * become live markup inside a page that Puppeteer then executes.
 *
 * The rule enforced here is *escape by default*. `html` is a tagged template
 * that escapes every interpolated value; the only way to insert real markup is
 * to pass a `SafeHtml`, which can only be produced by `html` itself or by the
 * deliberately-named `unsafeRawHtml` (used for static, developer-authored CSS).
 * That makes every injection point greppable.
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '=': '&#61;',
  '/': '&#47;',
};

const ESCAPE_PATTERN = /[&<>"'`=/]/g;

/**
 * Escape a string for insertion into HTML text or a quoted attribute.
 *
 * Beyond the usual five characters this also escapes `` ` ``, `=` and `/`,
 * which neutralises unquoted-attribute injection (`` foo=`bar` ``) and stray
 * `</script>` sequences — the classic OWASP-recommended superset.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(ESCAPE_PATTERN, (char) => ESCAPE_MAP[char] ?? char);
}

/** Markup that has already been escaped or is known-safe by construction. */
export class SafeHtml {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  toString(): string {
    return this.#value;
  }

  get value(): string {
    return this.#value;
  }
}

function stringify(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;

  if (Array.isArray(value)) {
    return value.map(stringify).join('');
  }

  return escapeHtml(value);
}

/**
 * Tagged template that escapes every interpolated value.
 *
 *   html`<td>${item.description}</td>`
 *
 * Nested `SafeHtml` values (and arrays of them) pass through unescaped, so
 * templates compose without double-escaping.
 */
export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): SafeHtml {
  let output = strings[0] ?? '';

  for (let index = 0; index < values.length; index += 1) {
    output += stringify(values[index]);
    output += strings[index + 1] ?? '';
  }

  return new SafeHtml(output);
}

/**
 * Mark a developer-authored constant as safe markup.
 *
 * Only ever call this with a literal written in this repository — never with a
 * value that originated from a request, the database, or the environment.
 * Every call site is meant to be reviewable at a glance.
 */
export function unsafeRawHtml(trustedMarkup: string): SafeHtml {
  return new SafeHtml(trustedMarkup);
}

/** Render text with newlines preserved as `<br>`, escaping everything else. */
export function nl2br(value: string | null | undefined): SafeHtml {
  if (!value) return new SafeHtml('');

  const escaped = escapeHtml(value)
    .split(/\r\n|\r|\n/)
    .join('<br>');

  return new SafeHtml(escaped);
}
