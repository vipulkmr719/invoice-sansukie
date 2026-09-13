-- Tenant-scoped foreign key.
--
-- Until now an invoice referenced a client by id alone, so the only thing
-- stopping one account from billing through another account's client was the
-- ownership check in application code. This migration makes that guarantee
-- structural: an invoice references (clientId, userId), and the client must
-- exist with that exact pair. A cross-tenant link is now rejected by the
-- database itself.

-- The composite key the invoice will reference.
CREATE UNIQUE INDEX "clients_id_userId_key" ON "clients" ("id", "userId");

ALTER TABLE "invoices" DROP CONSTRAINT "invoices_clientId_fkey";

-- NO ACTION rather than RESTRICT: deleting a user cascades to clients and
-- invoices in a single statement, and RESTRICT is checked immediately — it
-- would then succeed or fail depending on which cascade PostgreSQL happens to
-- run first. NO ACTION is checked at the end of the statement, by which point
-- the invoices are gone as well. Deleting a client that still has invoices is
-- still refused.
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_clientId_userId_fkey"
  FOREIGN KEY ("clientId", "userId") REFERENCES "clients" ("id", "userId")
  ON UPDATE CASCADE ON DELETE NO ACTION;
