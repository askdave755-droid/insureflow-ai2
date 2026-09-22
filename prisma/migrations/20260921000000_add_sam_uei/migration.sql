-- AlterTable: SAM.gov Unique Entity ID (dedupe key for sam-feeder)
-- IF NOT EXISTS: this DB has drift history (db push), so make re-application safe.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "uei" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "leads_uei_key" ON "leads"("uei");
