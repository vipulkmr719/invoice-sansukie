-- The issuer registration number printed on an invoice must satisfy the same
-- format rule as the one stored on the company profile. NULL is allowed so
-- invoices issued before the snapshot columns existed remain valid.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_issuer_registration_number_format"
  CHECK (
    "issuerRegistrationNumber" IS NULL
    OR "issuerRegistrationNumber" ~ '^T[0-9]{13}$'
  );
