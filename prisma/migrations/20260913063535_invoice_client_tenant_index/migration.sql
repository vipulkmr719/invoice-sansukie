-- Index matching the composite foreign key, so both the referencing-side
-- constraint checks and "all invoices for this client" lookups use one index.
DROP INDEX "invoices_clientId_idx";
CREATE INDEX "invoices_clientId_userId_idx" ON "invoices" ("clientId", "userId");
