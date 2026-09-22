/**
 * scripts/db-boot.js — runs BEFORE the server on every Railway deploy
 * (wired as the startCommand: `node scripts/db-boot.js && node src/server.js`).
 *
 * Why this exists (recurring incident 2026-09-19 + 2026-09-22):
 *   This database was built with `prisma db push`, so prisma/migrations was
 *   never actually applied through `migrate deploy`. Twice now, an out-of-band
 *   `db push` from a STALE checkout dropped leads.uei overnight; every
 *   lead.create() then failed P2022 until someone re-pushed the new schema.
 *
 * Three layers, in order:
 *   1. SELF-HEAL — idempotent DDL that re-adds leads.uei (+ unique index) if
 *      missing. Runs even if everything else fails. This alone would have
 *      prevented both incidents from costing a census batch.
 *   2. BASELINE — if _prisma_migrations has no record of the two historical
 *      migrations but their changes already exist in the DB, mark them
 *      applied (same as `prisma migrate resolve --applied`). Without this,
 *      `migrate deploy` would try to CREATE TABLE accounts on a live DB,
 *      fail, and block every future migration forever.
 *   3. MIGRATE — `prisma migrate deploy`, so every future migration committed
 *      to prisma/migrations auto-applies on deploy. Non-fatal on failure:
 *      self-heal has already run and the feeders have schema-drift circuit
 *      breakers, so a failed deploy can never flood the logs again.
 *
 * This script NEVER drops anything. ADD COLUMN IF NOT EXISTS only.
 */
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../src/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

// Historical migrations + a marker query that proves each one's changes are
// already live in the DB (returns >= 1 row when applied).
const HISTORICAL = [
  {
    name: '20260824_transportation_core',
    applied: `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'accounts'`,
  },
  {
    name: '20260921000000_add_sam_uei',
    applied: `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'uei'`,
  },
];

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

async function selfHeal() {
  const leads = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leads'`
  );
  if (!leads.length) {
    console.log('db-boot: no leads table (fresh DB) — skipping self-heal');
    return;
  }
  const col = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'uei'`
  );
  if (!col.length) {
    console.error('🚨 db-boot: leads.uei MISSING (stale db push strike again?) — re-adding now');
  }
  await prisma.$executeRawUnsafe('ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "uei" TEXT');
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "leads_uei_key" ON "leads"("uei")');
  console.log('🛡️ db-boot self-heal: leads.uei present');
}

async function ensureMigrationsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id"                  VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum"            VARCHAR(64) NOT NULL,
      "finished_at"         TIMESTAMPTZ,
      "migration_name"      VARCHAR(255) NOT NULL,
      "logs"                TEXT,
      "rolled_back_at"      TIMESTAMPTZ,
      "started_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
}

async function baseline() {
  await ensureMigrationsTable();
  for (const m of HISTORICAL) {
    const recorded = await prisma.$queryRawUnsafe(
      'SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1', m.name
    );
    if (recorded.length) continue;
    const isApplied = await prisma.$queryRawUnsafe(m.applied);
    if (!isApplied.length) {
      console.warn(`⚠️ db-boot baseline: ${m.name} not recorded AND its changes not found — leaving for migrate deploy`);
      continue;
    }
    const sqlFile = path.join(MIGRATIONS_DIR, m.name, 'migration.sql');
    const checksum = sha256File(sqlFile);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "started_at", "applied_steps_count")
       VALUES ($1, $2, now(), $3, NULL, now(), 1) ON CONFLICT DO NOTHING`,
      crypto.randomUUID(), checksum, m.name
    );
    console.log(`📌 db-boot baseline: marked ${m.name} as applied (changes already live)`);
  }
}

function migrateDeploy() {
  try {
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      timeout: 120000,
    });
    console.log('✅ db-boot: prisma migrate deploy clean');
  } catch (e) {
    // Non-fatal by design: self-heal already guaranteed the critical columns,
    // and feeder circuit breakers turn any remaining drift into one log line.
    console.error('⚠️ db-boot: prisma migrate deploy failed (non-fatal):', e.message);
  }
}

(async () => {
  try {
    await selfHeal();
    await baseline();
  } catch (e) {
    console.error('⚠️ db-boot setup error (non-fatal):', e.message);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
  migrateDeploy();
})();
