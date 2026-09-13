import { NextResponse } from 'next/server';

import { env } from '@/lib/env';
import { getStripe } from '@/server/billing/stripe';
import { applyWebhookEvent } from '@/server/billing/webhook-handler';
import { clientIpFromHeaders, consumeRateLimit } from '@/server/rate-limit';

/**
 * POST /api/stripe/webhook — the only entry point that may change billing.
 *
 * The order of operations matters:
 *
 *  1. Read the **raw** body. Stripe signs the exact bytes it sent; parsing to
 *     JSON first and re-serialising would change them and every signature would
 *     fail (or, worse, be skipped).
 *  2. Verify the signature with `STRIPE_WEBHOOK_SECRET`. Nothing below this
 *     line runs for an unsigned, mis-signed or replayed-too-late request — the
 *     SDK also enforces a timestamp tolerance, which is what stops a captured
 *     body being replayed days later.
 *  3. Apply the event idempotently.
 *
 * Note what is absent: this route reads no session, no cookie and no user id
 * from the request. It cannot be driven by a browser.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // Cheap flood control ahead of the HMAC work. Well above Stripe's real
  // delivery rate, so a genuine backlog is never dropped.
  const ip = clientIpFromHeaders(request.headers);
  const rate = await consumeRateLimit('webhook', ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'rate limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    );
  }

  const stripe = getStripe();
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    // Never accept an event we cannot verify. Without the secret there is no
    // way to tell a genuine Stripe delivery from anyone's POST.
    console.error('[stripe/webhook] received an event but billing is not configured');
    return NextResponse.json({ error: 'billing not configured' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  // Raw bytes, exactly as sent.
  const payload = await request.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    // Includes a bad signature, a tampered body and an expired timestamp.
    // The message can echo attacker-supplied input, so it is logged, not
    // returned.
    console.error(
      '[stripe/webhook] signature verification failed',
      error instanceof Error ? error.message : 'unknown error',
    );
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  try {
    const outcome = await applyWebhookEvent(event);

    if (outcome.result === 'duplicate') {
      // 200: the event is already applied, and Stripe must stop retrying.
      console.warn('[stripe/webhook]', outcome.detail);
    }

    return NextResponse.json({ received: true, result: outcome.result });
  } catch (error) {
    // 500 makes Stripe retry, which is what we want for a transient failure.
    console.error('[stripe/webhook] failed to apply event', event.id, error);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
