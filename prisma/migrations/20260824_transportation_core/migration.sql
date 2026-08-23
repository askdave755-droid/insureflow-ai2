-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('pending', 'scheduled', 'calling', 'called', 'qualified', 'converted', 'nurture', 'compliance_hold', 'rejected_timezone', 'closed');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('unchecked', 'clear', 'hold', 'blocked');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('NEW', 'QUALIFIED', 'RISK_PROFILED', 'SUBMITTED', 'QUOTED', 'PROPOSAL', 'BIND_PENDING', 'BOUND', 'LOST', 'NURTURE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'READY', 'SUBMITTED', 'UNDER_REVIEW', 'QUOTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('RECEIVED', 'PRESENTED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('ACTIVE', 'PENDING_CANCEL', 'CANCELLED', 'EXPIRED', 'NON_RENEWED');

-- CreateEnum
CREATE TYPE "RenewalStage" AS ENUM ('NOT_STARTED', 'CONTACTED', 'RE_MARKETING', 'QUOTED', 'PROPOSAL', 'BOUND', 'LOST');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "account_id" TEXT,
ADD COLUMN     "compliance_notes" TEXT,
ADD COLUMN     "compliance_status" TEXT NOT NULL DEFAULT 'unchecked';

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "dba" TEXT,
    "dot_number" TEXT,
    "mc_number" TEXT,
    "authority_status" TEXT,
    "state" TEXT NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "county" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "contact_name" TEXT,
    "contact_title" TEXT,
    "vehicle_count" INTEGER,
    "driver_count" INTEGER,
    "operating_radius" TEXT,
    "commodities" TEXT,
    "hazmat" BOOLEAN NOT NULL DEFAULT false,
    "naics_code" TEXT,
    "industry" TEXT,
    "revenue" INTEGER,
    "employee_count" INTEGER,
    "risk_score" INTEGER,
    "opportunity_score" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'NEW',
    "line_of_business" TEXT NOT NULL DEFAULT 'commercial_auto',
    "x_date" TIMESTAMP(3),
    "current_carrier" TEXT,
    "estimated_premium" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "risk_score" INTEGER,
    "opportunity_score" INTEGER,
    "lost_reason" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "opportunity_id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "package_json" JSONB,
    "appetite_match" JSONB,
    "submitted_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "declined_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'RECEIVED',
    "premium" DECIMAL(12,2),
    "commission_rate" DECIMAL(5,2),
    "coverage_json" JSONB,
    "effective_date" TIMESTAMP(3),
    "expiration_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "quote_id" TEXT,
    "policy_number" TEXT,
    "carrier" TEXT NOT NULL,
    "line_of_business" TEXT NOT NULL DEFAULT 'commercial_auto',
    "status" "PolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "effective_date" TIMESTAMP(3) NOT NULL,
    "expiration_date" TIMESTAMP(3) NOT NULL,
    "premium" DECIMAL(12,2),
    "commission_rate" DECIMAL(5,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewals" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "stage" "RenewalStage" NOT NULL DEFAULT 'NOT_STARTED',
    "renewal_date" TIMESTAMP(3) NOT NULL,
    "incumbent_premium" DECIMAL(12,2),
    "target_premium" DECIMAL(12,2),
    "bound_premium" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dnc_entries" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dnc_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_events" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT,
    "phone" TEXT,
    "channel" TEXT NOT NULL,
    "consent_type" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "proof_text" TEXT,
    "source" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounts_state_idx" ON "accounts"("state");

-- CreateIndex
CREATE INDEX "accounts_dot_number_idx" ON "accounts"("dot_number");

-- CreateIndex
CREATE INDEX "accounts_mc_number_idx" ON "accounts"("mc_number");

-- CreateIndex
CREATE INDEX "opportunities_account_id_stage_idx" ON "opportunities"("account_id", "stage");

-- CreateIndex
CREATE INDEX "opportunities_stage_priority_idx" ON "opportunities"("stage", "priority");

-- CreateIndex
CREATE INDEX "opportunities_x_date_idx" ON "opportunities"("x_date");

-- CreateIndex
CREATE INDEX "submissions_opportunity_id_status_idx" ON "submissions"("opportunity_id", "status");

-- CreateIndex
CREATE INDEX "submissions_carrier_status_idx" ON "submissions"("carrier", "status");

-- CreateIndex
CREATE INDEX "quotes_submission_id_idx" ON "quotes"("submission_id");

-- CreateIndex
CREATE INDEX "policies_account_id_status_idx" ON "policies"("account_id", "status");

-- CreateIndex
CREATE INDEX "policies_expiration_date_idx" ON "policies"("expiration_date");

-- CreateIndex
CREATE INDEX "renewals_renewal_date_stage_idx" ON "renewals"("renewal_date", "stage");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "dnc_entries_phone_idx" ON "dnc_entries"("phone");

-- CreateIndex
CREATE INDEX "dnc_entries_email_idx" ON "dnc_entries"("email");

-- CreateIndex
CREATE INDEX "consent_events_phone_channel_idx" ON "consent_events"("phone", "channel");

-- CreateIndex
CREATE INDEX "leads_account_id_idx" ON "leads"("account_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
