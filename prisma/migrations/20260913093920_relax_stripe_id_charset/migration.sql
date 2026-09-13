-- Widen the Stripe identifier checks to the full identifier charset.
--
-- The original patterns allowed only alphanumerics after the prefix. Stripe
-- does not publish a guarantee about the body of an object id, so a stricter
-- pattern than "has the right prefix" risks rejecting a genuine webhook and
-- silently losing a customer's entitlement. The prefix is what actually
-- matters: it stops a value of the wrong kind landing in the column.

ALTER TABLE "billing" DROP CONSTRAINT "billing_customer_id_format";
ALTER TABLE "billing" DROP CONSTRAINT "billing_subscription_id_format";
ALTER TABLE "billing" DROP CONSTRAINT "billing_price_id_format";

ALTER TABLE "billing"
  ADD CONSTRAINT "billing_customer_id_format"
  CHECK ("customerId" IS NULL OR "customerId" ~ '^cus_[A-Za-z0-9_]+$');

ALTER TABLE "billing"
  ADD CONSTRAINT "billing_subscription_id_format"
  CHECK ("subscriptionId" IS NULL OR "subscriptionId" ~ '^sub_[A-Za-z0-9_]+$');

ALTER TABLE "billing"
  ADD CONSTRAINT "billing_price_id_format"
  CHECK ("priceId" IS NULL OR "priceId" ~ '^price_[A-Za-z0-9_]+$');
