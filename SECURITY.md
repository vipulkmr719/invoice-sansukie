# Security

Security documentation for **インボイス作成 (Invoice Sakusei)** — a multi-tenant
SaaS that stores Japanese qualified invoices (適格請求書) and processes payments
through Stripe.

This document describes how the system is built, not how we would like it to
be. Where a control is partial or unverified, it says so. Known limitations are
listed at the end.

---

## 1. Authentication architecture

### Mechanism

Email and password, implemented with **Auth.js (NextAuth v5)** using the
Credentials provider and a JWT session strategy.

| Element | Implementation |
| --- | --- |
| Password hashing | **scrypt** (N = 2¹⁷, r = 8, p = 1), 16-byte random salt, 64-byte derived key |
| Comparison | `crypto.timingSafeEqual` — constant time |
| Stored format | `scrypt$N$r$p$<salt b64>$<key b64>` — parameters live in the hash, so the cost can be raised later without invalidating existing credentials |
| Password policy | ≥ 10 characters, must contain a letter and a digit |
| Normalisation | NFKC before hashing, so a password typed on a different OS still authenticates |
| Session | HS256 JWT signed with `AUTH_SECRET`, carrying the user id only |
| Session lifetime | 7 days, re-issued at most once per day |

No password, in any form other than a scrypt hash, is ever written to the
database, a log, an error message, or a form re-render. The `collectValues`
helper that repopulates a rejected form is given an explicit field list and is
never passed a password field.

### Why scrypt rather than bcrypt

scrypt is memory-hard, is an OWASP-recommended password hash, has no 72-byte
truncation limit, and ships inside Node's standard library — so the credential
path carries no third-party dependency and no native build step. bcrypt would
be a defensible alternative; the stored format records its own algorithm, so a
migration could run both side by side.

### Account enumeration

Every sign-in failure returns exactly one message:

> メールアドレスまたはパスワードが正しくありません。

An unknown address, a wrong password, and an account with no password set are
indistinguishable in both **content** and **timing** — when no account exists,
the server still performs a full scrypt comparison against a decoy hash
generated once per process.

### Brute-force resistance

Two independent limits, both stored in the database so they hold across
instances and restarts:

| Limit | Key | Budget |
| --- | --- | --- |
| Sign-in attempts per source | IP address | 20 / 10 min |
| Sign-in attempts per account | normalised email | 10 / 15 min |
| Account creation | IP address | 10 / hour |

The per-account limit is the one that matters against a distributed attack: an
attacker with many source addresses defeats a per-IP cap, but every attempt
still names the account under attack. The account key is the lower-cased,
trimmed address, so `USER@x.test` and ` user@x.test ` share one bucket rather
than each minting a fresh allowance.

Throttled attempts return the same generic message, so the limiter does not
itself become an enumeration oracle.

### Session invalidation

Signing out clears the session cookie and redirects, as two separate steps —
the cookie deletion completes before the redirect is thrown, so the browser can
never land on the next page still holding a valid token.

Beyond the cookie, `requireUser()` re-reads the account from the database on
**every** protected request. A deleted account stops working immediately rather
than when its JWT happens to expire.

---

## 2. Authorization model

### Layers

Authorization is enforced at three independent layers. No single one is the
only thing standing between two customers' data.

```
Request
  │
  ├─ 1. Edge proxy (src/proxy.ts)
  │     Auth.js verifies the session JWT signature; anonymous requests to a
  │     protected route are redirected. An optimisation, not the boundary.
  │
  ├─ 2. Page / action guard (src/server/auth/guard.ts)
  │     requireUser() resolves the identity and re-checks it against the
  │     database. The user id it returns is the ONLY tenant key used below.
  │
  └─ 3. Data access (src/server/db/*)
        Every query is scoped by that user id, in the WHERE clause.
```

### The rule

Ownership is expressed **in the query**, never checked afterwards:

```ts
// Correct — used throughout
prisma.invoice.findFirst({ where: { id, userId } })

// Never written; refused at runtime by the tenant guard
prisma.invoice.findUnique({ where: { id } })
```

A request for another tenant's id therefore returns nothing. The response is
identical to one for an id that does not exist — **404, never 403** — so the
error itself does not confirm that a record is real.

### Enforcement

| Control | Where | What it catches |
| --- | --- | --- |
| Tenant guard | `src/server/db/tenant-guard.ts` | A Prisma client extension that **refuses** any query on `Client`, `Invoice`, `InvoiceItem`, `Company` or `Billing` that is not scoped to the owning user, before it reaches the database. A scope hidden inside `OR` is rejected — one unscoped branch widens the result set. |
| Static audit | `tests/data-access-audit.test.ts` | Reads the source: no page, component, action or route may import the Prisma client, and every tenant query must mention `userId`. Catches a new repository function whether or not any test exercises it. |
| Composite foreign key | database | `invoices(clientId, userId)` references `clients(id, userId)`. An invoice cannot reference another tenant's client even if the application is bypassed entirely. |

### Privilege model

There are no roles. Every account has identical capability over its own data
and none over anyone else's, so there is no privilege to escalate *to*. Paid
entitlement is not a privilege level: it is a quota, read from the billing row
and applied only to invoice creation.

---

## 3. Data isolation model

### Ownership

| Table | Owner | Isolation |
| --- | --- | --- |
| `companies` | `userId` (unique) | one company per account |
| `clients` | `userId` | plus a unique `(id, userId)` key used as a foreign-key target |
| `invoices` | `userId` | references clients by `(clientId, userId)` |
| `invoice_items` | via `invoiceId` | reachable only through a scoped invoice |
| `billing` | `userId` (unique) | Stripe ids are unique, so a customer maps to one account |

### Deletion

- Deleting a user cascades to company, clients, invoices, invoice items and
  billing — **that account's rows and no others.**
- `invoices → clients` is `ON DELETE NO ACTION`, not `RESTRICT`, deliberately.
  Deleting a user cascades to clients and invoices in a single statement;
  `RESTRICT` is checked immediately and would succeed or fail depending on
  which cascade PostgreSQL happens to run first. `NO ACTION` is checked at the
  end of the statement, by which point the invoices are gone too. Deleting a
  client that still has invoices is still refused.
- Deleting an invoice cascades to its items.

### Transaction boundaries

| Operation | Boundary |
| --- | --- |
| Invoice creation | One transaction, behind `pg_advisory_xact_lock(hashtextextended(userId))`. Ownership check, duplicate check, quota check and insert are atomic — a concurrent burst from one free account cannot exceed the limit. |
| Webhook application | One transaction that inserts the Stripe event id **before** writing billing. There is no window in which one half committed and the other did not. |
| Rate limiting | A single `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so two concurrent requests cannot both read the same count. |

---

## 4. Payment security

### What is stored

**Stripe identifiers only.** No card number, CVV, expiry, cardholder name or
any other raw payment credential is received or stored. Card details are
entered on Stripe's hosted Checkout page, which the browser reaches directly.

The `billing` table holds: `customerId` (`cus_…`), `subscriptionId` (`sub_…`),
`priceId` (`price_…`), a status, a plan, a period end and a cancellation flag.
A test asserts that no column in any table matches a card-data name pattern.

### Entitlement is server-side only

> **Reaching `/payment/success` unlocks nothing.**

The success page performs **no write of any kind** — no billing update, no
session mutation, no verification of the `session_id` query parameter. A test
asserts this structurally by reading the page's source. Anyone may type the
URL, bookmark it, or arrive with a forged parameter; the account's plan is
exactly what it was before.

Entitlement is decided by one pure function whose only inputs are the billing
row and the current time. It **fails closed**:

- An expired `currentPeriodEnd` grants nothing, even if the stored status still
  reads `active` — so a missed cancellation webhook cannot leave an account
  paid indefinitely.
- An unrecognised Stripe status maps to `unpaid`, so a status Stripe adds in
  future cannot accidentally entitle.
- `past_due` does not entitle: Stripe holds a subscription there while retrying
  a failed payment, and the period has not been paid for.

### Webhook integrity

| Control | Implementation |
| --- | --- |
| Signature verification | `stripe.webhooks.constructEvent` over the **raw request bytes**. Parsing to JSON and re-serialising would change the bytes and break every signature. |
| Replay window | The Stripe SDK's timestamp tolerance (300 s by default) rejects a captured body replayed later. |
| Idempotency | The event id is inserted into `processed_webhook_events` inside the same transaction that writes billing. A redelivery hits the primary key and the transaction rolls back. |
| Identity | The account is resolved from the recorded Stripe customer id, or from the `client_reference_id` that **this server** set when creating the Checkout session. A user id placed in event metadata by anyone else is ignored. |
| Unconfigured | Without `STRIPE_WEBHOOK_SECRET` the endpoint returns **503**. An event that cannot be verified is never trusted. |
| Failure | A transient failure returns 500 so Stripe retries. An unhandled event type returns 200 so Stripe stops. |
| Flood control | 240 requests/minute per IP, ahead of the HMAC work. Set well above Stripe's real delivery rate so a genuine backlog is never dropped. |

---

## 5. Secret management

### Inventory

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✔ | PostgreSQL connection string |
| `AUTH_SECRET` | ✔ | Session JWT signing key (≥ 32 chars) |
| `APP_URL` | | Public origin; also decides Secure-cookie mode |
| `ALLOWED_ORIGINS` | | Extra origins accepted for Server Actions behind a proxy |
| `PDF_CHROME_PATH` | | Chrome binary for PDF rendering |
| `STRIPE_SECRET_KEY` | | Stripe API key; billing disabled when absent |
| `STRIPE_WEBHOOK_SECRET` | | Webhook signature key |
| `STRIPE_PRICE_ID_MONTHLY` | | Monthly plan price |
| `STRIPE_PRICE_ID_LIFETIME` | | One-time purchase price |

### Handling rules

1. **One reader.** `src/lib/env.ts` is the only hand-written module that reads
   `process.env` (plus `prisma.config.ts`, which runs at CLI time only). A test
   asserts this.
2. **Validated at startup.** Zod parses the environment at module evaluation,
   so a misconfigured deployment fails immediately rather than at the first
   request that needs a secret. Stripe keys are additionally checked for the
   right prefix, which catches a publishable key pasted where a secret belongs.
3. **Never logged.** Validation failures print the variable **name** and the
   reason, never the value — a malformed `DATABASE_URL` still contains a
   password.
4. **Server-only.** Every module that touches a secret imports `server-only`,
   so a `"use client"` module that reaches one fails the build. No
   `NEXT_PUBLIC_` variable exists. A build-time scan asserts that no secret
   appears in `.next/static`.
5. **Never committed.** `.env`, `.env.*`, `*.env`, `*.key`, `*.pem` and similar
   are git-ignored; only `.env.example` is tracked.

### Rotation

- `AUTH_SECRET` — rotating invalidates every session; users sign in again.
- `STRIPE_WEBHOOK_SECRET` — rotate in the Stripe dashboard and deploy together;
  Stripe supports overlapping secrets during a roll.
- `DATABASE_URL` — rotate the database password, then redeploy.

---

## 6. Transport and browser security

### HTTPS

TLS is terminated by the platform in front of the application. On an HTTPS
deployment the application sends:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `upgrade-insecure-requests` in the CSP

Both are gated on `APP_URL` starting with `https://` — the same single predicate
(`src/lib/transport.ts`) that decides Secure cookies, so the three can never
disagree. Gating them on `NODE_ENV` instead is the classic mistake: a staging or
internal deployment built in production mode but served over plain HTTP would
then upgrade its own subresource requests to a scheme nothing is listening on,
while still handing out cookies the browser silently drops. Sending HSTS from a
development server would additionally pin `localhost` to HTTPS in the
developer's browser for the life of the max-age.

### Cookies

| Cookie | httpOnly | SameSite | Secure (HTTPS) | Name prefix (HTTPS) |
| --- | --- | --- | --- | --- |
| session token | ✔ | Lax | ✔ | `__Secure-` |
| CSRF token | ✔ | Lax | ✔ | `__Host-` |
| callback URL | ✔ | Lax | ✔ | `__Secure-` |

`httpOnly` is the property that matters most: it means an XSS bug cannot
exfiltrate a session. `SameSite=Lax` blocks a cross-site form or image from
driving a state-changing request with the user's credentials. `Strict` would be
marginally tighter but breaks the return from Stripe Checkout, where the
browser arrives from an external origin and must still be signed in.

The `__Host-` prefix on the CSRF cookie is browser-enforced: it is accepted only
when the cookie is Secure, `path=/` and carries no `Domain`, so no sibling
subdomain can set or overwrite it.

Secure mode is driven by `isSecureDeployment()` in `src/lib/transport.ts` —
whether `APP_URL` is `https://`, not what `NODE_ENV` says. A staging build
running in production mode behind plain HTTP would otherwise set cookies the
browser refuses to store, and the session would silently never persist. The
same predicate gates HSTS and `upgrade-insecure-requests`; a unit test asserts
all three move together.

### Content Security Policy

A per-request nonce is generated in the edge proxy and placed in the CSP on both
the forwarded request and the response. Next.js reads the nonce from the request
header and stamps it onto the inline scripts it injects.

```
default-src 'none';
script-src 'self' 'nonce-<per request>' 'strict-dynamic';
style-src 'self';
style-src-attr 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
manifest-src 'self';
worker-src 'self' blob:;
base-uri 'none';
form-action 'self';
frame-ancestors 'none';
object-src 'none';
upgrade-insecure-requests            (HTTPS deployments only)
```

Notes on the choices that are easy to get wrong:

- **No `'unsafe-inline'` for scripts and no `'unsafe-eval'` anywhere.** Shipping
  a validation library to the browser would have forced `'unsafe-eval'` open;
  `src/domain/limits.ts` exists so forms can read a limit without pulling Zod
  into the client bundle.
- **`default-src 'none'`** means a directive we forget fails closed rather than
  inheriting `'self'`.
- **`style-src-attr 'unsafe-inline'` is separate from `style-src`.** The app
  sets a few inline `style=` attributes (chart bar heights, the select arrow).
  Allowing them there keeps `style-src` strict, so an injected `<style>` block
  is still refused.
- The policy was derived from what the app actually serves and then **tested
  against every page** — see `tests/security-headers.test.ts` and the browser
  suite, which asserts zero CSP violations across all routes while sign-up,
  server actions, live recalculation, dynamic rows and PDF download all work.

### Other headers

`X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` ·
`Referrer-Policy: strict-origin-when-cross-origin` ·
`Permissions-Policy` (camera, microphone, geolocation, payment, USB and others
disabled) · `Cross-Origin-Opener-Policy: same-origin` ·
`Cross-Origin-Resource-Policy: same-origin` · `X-DNS-Prefetch-Control: off`.
`X-Powered-By` is disabled.

---

## 7. CSRF protection

Two mechanisms, each verified against the running server:

1. **Server Actions.** Next.js compares the `Origin` header against the host and
   aborts on mismatch. Observed: a POST with `Origin: https://evil.example` is
   refused with *"does not match origin header … Aborting the action."*
   `ALLOWED_ORIGINS` declares additional legitimate origins behind a proxy.
2. **Auth.js endpoints.** A double-submit CSRF token. Observed: a sign-in POST
   without the token is rejected with `MissingCSRF` and **no session cookie is
   set**.

`SameSite=Lax` is the third layer: a cross-site POST does not carry the session
cookie at all.

---

## 8. Input handling

Validation **does not sanitise**. A company may legitimately be called
`A < B Ltd`, so stripping characters would break real users while doing nothing
for security. Values are stored verbatim as data and neutralised at each
boundary:

| Boundary | Control |
| --- | --- |
| HTML (PDF template) | `src/lib/html.ts` — an escape-by-default tagged template. The only way to insert real markup is `unsafeRawHtml()`, called exactly once, on a constant stylesheet. |
| HTML (web UI) | React escapes by default; `dangerouslySetInnerHTML` appears nowhere. |
| SQL | Prisma parameterised queries. The only raw SQL is a constant `SELECT 1` and two parameterised statements. |
| Numbers | Parsed with explicit finite checks; money is computed with BigInt, never floats. |

Every user-controlled field is tested against XSS, HTML injection, SQL
injection, template injection, oversized input and malformed Unicode
(`tests/input-security.test.ts`).

---

## 9. PDF security

The PDF is rendered by Puppeteer from HTML this application builds. Four
controls, in depth:

1. **Escaping.** Every user value passes through the `html` tagged template.
2. **No JavaScript.** `page.setJavaScriptEnabled(false)`. Even if an escaping
   bug let a `<script>` through, there is no engine to run it and no
   `onerror=` handler can fire.
3. **No network.** Every request except the initial document is aborted. The
   template is self-contained, so a legitimate render needs no network at all —
   which turns an injected `<img src=http://attacker/?c=…>` into a dead link and
   closes the SSRF path into internal services that a rendering box would
   otherwise expose.
4. **Isolation.** A fresh incognito browser context per request, a 20-second
   timeout, and guaranteed teardown.

Access is scoped like everything else: `GET /invoices/:id/pdf` resolves the
invoice through the same user-scoped repository, so another account's id yields
404 and **no PDF is generated**. Anonymous requests get 401 JSON, not an HTML
login page under a 200.

---

## 10. Error handling

- `AppError` subclasses carry Japanese messages written to be shown to a user.
- Everything else is logged server-side with its stack and replaced with one
  generic sentence. Stack traces, SQL fragments, connection strings and Stripe
  key material never reach a response.
- Server Actions return a typed result rather than throwing across the
  server/client boundary.
- The webhook route logs the verification failure reason but returns only
  `{"error":"invalid signature"}` — the underlying message can echo
  attacker-supplied input.
- The global error boundary renders a fixed sentence plus Next's opaque digest,
  never `error.message`.

---

## 11. Rate limiting

Counters live in PostgreSQL, not process memory: an in-memory counter is
per-replica and resets on deploy, which is not a limit at all behind more than
one instance.

| Bucket | Key | Budget |
| --- | --- | --- |
| Sign-in | IP | 20 / 10 min |
| Sign-in | account | 10 / 15 min |
| Registration | IP | 10 / hour |
| Checkout creation | user | 5 / 10 min |
| Invoice creation | user | 60 / 10 min |
| Stripe webhook | IP | 240 / min |

The limiter **fails open**: if the counter table is unreachable it logs and
allows the request. A limiter that failed closed would take the whole
application down with the database, whereas failing open loses only abuse
control.

Windows are fixed rather than sliding, so up to 2× the budget can pass across a
boundary. Acceptable for abuse control; not a hard guarantee.

---

## 12. Database operations, backup and recovery

Invoices are legal records under the 適格請求書等保存方式: a lost invoice is not
merely inconvenient. Treat the database as the system of record and everything
else as reconstructible.

### Connection and privilege

The application connects as a role that owns its own database and nothing else.
Verified on the production-like deployment:

| Property | Required | Verified |
| --- | --- | --- |
| `rolsuper` | false | ✔ |
| `rolcreatedb` | false | ✔ |
| `rolcreaterole` | false | ✔ |
| `rolbypassrls` | false | ✔ |
| `CONNECT` on any other database | revoked | ✔ |

`CONNECT` is granted to `PUBLIC` by default on every PostgreSQL database, so
granting nothing is not the same as revoking. Revoke it explicitly on each
database and grant it back only to that database's own role:

```sql
REVOKE CONNECT ON DATABASE <db> FROM PUBLIC;
GRANT  CONNECT ON DATABASE <db> TO <role>;
```

Without this the production role can open the development database, and vice
versa — which is how a "staging" deployment ends up writing to production.

### Connection pooling

The Prisma driver adapter (`@prisma/adapter-pg`) pools connections per process,
and `connection_limit` in `DATABASE_URL` sets the pool size. Measured on the
production-like deployment: 25 concurrent requests held 11 server connections at
`connection_limit=10`, and 7 at `connection_limit=3`.

The number that matters in production is *per instance* × *instances*. On a
platform that scales to many short-lived instances — serverless in particular —
each one opens its own pool, so the server-side total can exceed
`max_connections` long before any single instance misbehaves. Put an external
pooler (PgBouncer, or the platform's own pooled endpoint) in front, point
`DATABASE_URL` at it, and keep `connection_limit` small.

### Backups

Nightly `pg_dump` in custom format, retained 30 days, plus whatever
point-in-time recovery the platform offers:

```bash
pg_dump "$DATABASE_URL" -Fc -f invoice-$(date +%Y%m%d).dump
```

Custom format (`-Fc`) rather than plain SQL: it restores selectively, in
parallel, and compresses. Store dumps encrypted and off the database host — a
backup on the same disk survives nothing that matters.

### Recovery

```bash
createdb invoice_restore
pg_restore -d "$RESTORE_URL" invoice-YYYYMMDD.dump
```

**Test the restore, do not assume it.** An untested backup is a belief, not a
strategy. The check that catches a bad dump is row counts *and* constraints:

```sql
SELECT count(*) FROM users;          -- must match the source
SELECT count(*) FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'public' AND contype = 'c';   -- must be 14
```

A dump that restores rows but drops CHECK constraints leaves a database that
accepts data the application considers impossible. This procedure was exercised
end to end during pre-launch verification: dump, restore into a fresh database,
and both row counts and all 14 CHECK constraints matched.

### Migrations

`prisma migrate deploy` only — never `migrate dev` against production, which can
reset. Run it as a deploy step before the new code serves traffic, and confirm
`prisma migrate status` reports no drift afterwards.

---

## 13. Reporting a vulnerability

**Please do not open a public GitHub issue for a security problem.**

1. Email **security@example.com** with:
   - a description of the issue and its impact,
   - the steps or proof-of-concept needed to reproduce it,
   - the affected version or commit,
   - how you would like to be credited (or that you prefer not to be).
2. You will receive an acknowledgement within **3 business days**.
3. We aim to confirm or dismiss the report within **10 business days**, and to
   ship a fix for a confirmed high-severity issue within **30 days**.
4. Please give us 90 days before public disclosure, or until a fix ships,
   whichever comes first.

> Replace `security@example.com` with a real, monitored address before
> deploying. An unmonitored address is worse than none — it tells a finder they
> have reported the issue when nobody has read it.

### In scope

The application, its API routes, the Stripe webhook, authentication,
authorization, the PDF pipeline and the deployment configuration in this
repository.

### Out of scope

Findings against Stripe's own systems (report to Stripe), automated scanner
output with no demonstrated impact, missing headers on endpoints that serve no
content, social engineering, physical attacks, and denial of service by volume.

### Safe harbour

Good-faith research that respects user privacy, avoids degrading the service and
uses only your own test accounts will not be pursued. Do not access, modify or
retain another person's data — a proof of concept against your own second
account is sufficient, and is exactly how our own IDOR tests are written.

---

## 14. Known limitations

These are stated plainly rather than omitted. See the project README for the
full list.

| # | Limitation | Impact |
| --- | --- | --- |
| 1 | **Stripe has never been contacted from this environment.** Signature verification, idempotency and entitlement are verified against the real Stripe SDK and a real database, but no live Checkout has been completed. | Run one test-mode payment with `stripe listen` before going live. |
| 2 | **Auth.js v5 is beta** (`5.0.0-beta.32`). | It is the only App Router–native line; v4 is Pages Router. |
| 3 | **No cancellation UI.** Users cannot self-serve cancel; the webhook side handles cancellation correctly. | Needs `billingPortal.sessions.create`. |
| 4 | **Fixed-window rate limiting.** | Up to 2× the budget across a window boundary. |
| 5 | **No audit log.** Security-relevant events are logged to stdout, not to a queryable, tamper-evident store. | Forensics after an incident would be limited. |
| 6 | **No MFA, no password reset, no email verification.** | An account is only as strong as its password; a forgotten password cannot be recovered. |
| 7 | **No automated dependency scanning in CI.** `npm audit` reports 4 high findings in the Prisma CLI's dev-only transitive dependencies (including `mysql2`, which this PostgreSQL app never loads). | Not in the runtime bundle; should still be tracked. |
| 8 | **Secrets come from the environment only.** No KMS or secret-manager integration. | Adequate for most platforms; consider a manager for higher assurance. |
| 9 | **No invoice editing.** Create, view and delete only. | A correction means a new invoice. |
| 10 | **scrypt, not bcrypt.** | Deliberate — see §1. Noted because a policy may name bcrypt specifically. |
| 11 | **Sessions are stateless JWTs, so sign-out is client-side.** Logging out clears the cookie, and every protected request re-checks the subject against the database — a deleted or disabled account stops working immediately. But a token captured *before* sign-out stays valid until it expires (7 days max, re-issued at most daily); there is no server-side revocation list. | An attacker who already has the cookie is not evicted by the user pressing "ログアウト". Mitigations in place: `httpOnly` + `SameSite=Lax` + `Secure` make capture hard, and the database re-check bounds the damage of a *disabled* account to zero. A deployment that needs true revocation should add a token-version column checked in `getCurrentUser()`, or move to database sessions. |
