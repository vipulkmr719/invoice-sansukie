-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "clientAddressSnapshot" TEXT,
ADD COLUMN     "clientEmailSnapshot" TEXT,
ADD COLUMN     "clientNameSnapshot" TEXT,
ADD COLUMN     "issuerAddress" TEXT,
ADD COLUMN     "issuerEmail" TEXT,
ADD COLUMN     "issuerName" TEXT,
ADD COLUMN     "issuerPhone" TEXT,
ADD COLUMN     "issuerRegistrationNumber" TEXT;
