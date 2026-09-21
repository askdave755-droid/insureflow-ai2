-- AlterTable: SAM.gov Unique Entity ID (dedupe key for sam-feeder)
ALTER TABLE "leads" ADD COLUMN "uei" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "leads_uei_key" ON "leads"("uei");
