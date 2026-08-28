-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 1 — TENANCY + INSTANTLY (additive, zero data loss)
-- Adds Client + AgencyProspect tables and nullable client_id columns /
-- indexes / FKs on leads, accounts, opportunities, tasks, costs,
-- dnc_entries, consent_events. Generated locally with:
--   npx prisma migrate diff --from-schema-datamodel <old schema> \
--     --to-schema-datamodel prisma/schema.prisma --script
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "client_id" TEXT;

-- AlterTable
ALTER TABLE "costs" ADD COLUMN     "client_id" TEXT;

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "client_id" TEXT;

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "client_id" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "client_id" TEXT;

-- AlterTable
ALTER TABLE "dnc_entries" ADD COLUMN     "client_id" TEXT;

-- AlterTable
ALTER TABLE "consent_events" ADD COLUMN     "client_id" TEXT;

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "licensed_states" TEXT[],
    "vapi_assistant_id" TEXT,
    "vapi_phone_number_id" TEXT,
    "calendly_link" TEXT,
    "brevo_sender_name" TEXT,
    "brevo_sender_email" TEXT,
    "branding_json" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_prospects" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "agency_name" TEXT,
    "phone" TEXT,
    "state" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "instantly_lead_id" TEXT,
    "instantly_campaign_id" TEXT,
    "last_event" TEXT,
    "notes" TEXT,
    "client_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_prospects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_slug_key" ON "clients"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "agency_prospects_email_key" ON "agency_prospects"("email");

-- CreateIndex
CREATE INDEX "agency_prospects_status_updated_at_idx" ON "agency_prospects"("status", "updated_at");

-- CreateIndex
CREATE INDEX "agency_prospects_client_id_idx" ON "agency_prospects"("client_id");

-- CreateIndex
CREATE INDEX "agency_prospects_instantly_lead_id_idx" ON "agency_prospects"("instantly_lead_id");

-- CreateIndex
CREATE INDEX "leads_client_id_status_idx" ON "leads"("client_id", "status");

-- CreateIndex
CREATE INDEX "costs_client_id_created_at_idx" ON "costs"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "accounts_client_id_idx" ON "accounts"("client_id");

-- CreateIndex
CREATE INDEX "opportunities_client_id_stage_idx" ON "opportunities"("client_id", "stage");

-- CreateIndex
CREATE INDEX "tasks_client_id_status_idx" ON "tasks"("client_id", "status");

-- CreateIndex
CREATE INDEX "dnc_entries_client_id_phone_idx" ON "dnc_entries"("client_id", "phone");

-- CreateIndex
CREATE INDEX "dnc_entries_client_id_email_idx" ON "dnc_entries"("client_id", "email");

-- CreateIndex
CREATE INDEX "consent_events_client_id_phone_idx" ON "consent_events"("client_id", "phone");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costs" ADD CONSTRAINT "costs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dnc_entries" ADD CONSTRAINT "dnc_entries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_prospects" ADD CONSTRAINT "agency_prospects_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

