-- Defence in depth: the database rejects impossible values even if a bug ever
-- lets unvalidated input past the Zod schemas in src/validation.

-- 適用税率は 8% (軽減税率) または 10% (標準税率) のみ
ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_tax_rate_allowed"
  CHECK ("taxRate" IN (8, 10));

-- 数量・単価・金額は負の値を取らない
ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_quantity_non_negative"
  CHECK ("quantity" >= 0);

ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_unit_price_non_negative"
  CHECK ("unitPrice" >= 0);

ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_amount_non_negative"
  CHECK ("amount" >= 0);

-- 請求書の各金額も負の値を取らない
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_amounts_non_negative"
  CHECK ("subtotal" >= 0 AND "tax8" >= 0 AND "tax10" >= 0 AND "total" >= 0);

-- 合計は 小計 + 消費税8% + 消費税10% と一致する
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_total_is_consistent"
  CHECK ("total" = "subtotal" + "tax8" + "tax10");

-- 支払期限は発行日以降
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_due_after_issue"
  CHECK ("dueDate" >= "issueDate");

-- 登録番号は "T" + 数字13桁
ALTER TABLE "companies"
  ADD CONSTRAINT "companies_registration_number_format"
  CHECK ("registrationNumber" ~ '^T[0-9]{13}$');
