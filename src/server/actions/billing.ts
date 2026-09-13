'use server';

import { redirect } from 'next/navigation';

import { actionFailure, type ActionResult } from '@/lib/action-result';
import { toPublicErrorMessage } from '@/lib/errors';
import { requireUserForAction } from '@/server/auth/guard';
import {
  createCheckoutSession,
  UnknownPriceError,
  type PurchaseKind,
} from '@/server/billing/checkout';
import { BillingNotConfiguredError } from '@/server/billing/stripe';
import { consumeRateLimit } from '@/server/rate-limit';

/**
 * Start Stripe Checkout.
 *
 * Note what this action does NOT do: it never touches the billing row, and it
 * never grants anything. Its whole job is to produce a Stripe URL. Entitlement
 * is written later, by the webhook, after Stripe has actually taken the money.
 */

const VALID_KINDS: PurchaseKind[] = ['monthly', 'lifetime'];

export async function startCheckoutAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  const raw = formData.get('kind');
  const kind = VALID_KINDS.find((candidate) => candidate === raw);

  if (!kind) {
    return actionFailure('プランを選択してください。');
  }

  let checkoutUrl: string;

  try {
    const user = await requireUserForAction();

    // Keyed by user id, not IP: each Checkout call creates a Stripe customer
    // and a session, so the cost is per account.
    const rate = await consumeRateLimit('checkout', user.id);
    if (!rate.allowed) {
      return actionFailure(
        'お手続きの試行回数が上限に達しました。しばらくしてからお試しください。',
      );
    }

    const session = await createCheckoutSession({
      userId: user.id,
      email: user.email,
      kind,
    });

    checkoutUrl = session.url;
  } catch (error) {
    if (error instanceof BillingNotConfiguredError || error instanceof UnknownPriceError) {
      return actionFailure(error.message);
    }
    return actionFailure(toPublicErrorMessage(error, 'startCheckoutAction'));
  }

  // Stripe's hosted Checkout page. redirect() throws, so it sits outside the try.
  redirect(checkoutUrl);
}
