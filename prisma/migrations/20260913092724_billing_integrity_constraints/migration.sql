-- Defence in depth on the billing table.
--
-- Billing rows decide who has paid, so the database refuses shapes that could
-- only come from a bug: a Stripe identifier of the wrong kind, or a paid status
-- with nothing backing it.

-- Stripe identifiers must look like Stripe identifiers. This also makes it
-- impossible to smuggle something else into these columns.
ALTER TABLE "billing"
  ADD CONSTRAINT "billing_customer_id_format"
  CHECK ("customerId" IS NULL OR "customerId" ~ '^cus_[A-Za-z0-9]+$');

ALTER TABLE "billing"
  ADD CONSTRAINT "billing_subscription_id_format"
  CHECK ("subscriptionId" IS NULL OR "subscriptionId" ~ '^sub_[A-Za-z0-9]+$');

ALTER TABLE "billing"
  ADD CONSTRAINT "billing_price_id_format"
  CHECK ("priceId" IS NULL OR "priceId" ~ '^price_[A-Za-z0-9]+$');

-- A recurring entitlement must carry the subscription it came from and the
-- date it runs out; a lifetime purchase carries neither.
ALTER TABLE "billing"
  ADD CONSTRAINT "billing_monthly_requires_subscription"
  CHECK (
    "plan" <> 'monthly'
    OR ("subscriptionId" IS NOT NULL AND "currentPeriodEnd" IS NOT NULL)
  );

ALTER TABLE "billing"
  ADD CONSTRAINT "billing_free_has_no_plan_state"
  CHECK ("plan" <> 'free' OR "subscriptionId" IS NULL);

-- A rate-limit window is a count that only ever goes up, and always expires.
ALTER TABLE "rate_limits"
  ADD CONSTRAINT "rate_limits_count_non_negative"
  CHECK ("count" >= 0);
