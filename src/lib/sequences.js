/**
 * sequences.js — the quote_followup / cross-sell sequence engine.
 *
 * Step definitions live in /sequences/*.json (Dave's spec files — the
 * single source of truth). This engine is the runner:
 *
 *   enroll(lead, name, mergeFields, opts)  -> enrollment row + Bull delayed jobs
 *   stopEnrollment(leadId, reason, name?)  -> halts automation for a lead
 *   callQueue.process('sequence-step')     -> fires each step when its delay hits
 *
 * Design notes:
 * - State lives in Postgres (sequence_enrollments, created lazily via the
 *   pool shim — no Prisma migration needed). Bull jobs only carry
 *   { enrollmentId, stepIndex }; stopped/completed enrollments no-op on fire.
 * - Channels: 'sms' | 'email' | 'email+sms' via Brevo; 'vapi_call' queues a
 *   make-call job (the call worker enforces business hours itself).
 * - Quiet hours: message steps only fire inside the lead's state calling
 *   window; outside it the job reschedules to the next window.
 * - DNC is re-checked before EVERY step — an opt-out between steps stops
 *   the sequence at the next touch.
 * - quote_followup_v1 vertical_branches swap day-5/day-9 copy per vertical.
 * - trucking_cross_sell_v1 day-16 is conditional on owner_age >= 60
 *   (umbrella swap below), and after the day-45 audit call the sequence
 *   loops back to the day-28 step on a 90-day cycle (quarterly).
 *
 * NOTE on casts: Prisma $queryRawUnsafe infers all params as text —
 * id comparisons need $1::uuid and the merge insert needs $3::jsonb.
 */

const fs = require('fs');
const path = require('path');
const prisma = require('../db');
const pool = require('./pool');
const { callQueue } = require('../queue');
const { brevoEmail, brevoSMS } = require('./brevo');
const { isBusinessHours, getNextBusinessTime } = require('./validate');

const SEQ_DIR = path.join(__dirname, '..', '..', 'sequences');
const seqCache = {};

function loadSequence(name) {
  if (!seqCache[name]) {
    const file = path.join(SEQ_DIR, name + '.json');
    seqCache[name] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return seqCache[name];
}

// ── enrollment table (raw SQL via the pool shim — no migration) ──
let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = pool.query(
      `CREATE TABLE IF NOT EXISTS sequence_enrollments (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         lead_id TEXT NOT NULL,
         sequence TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'active',
         stop_reason TEXT,
         merge JSONB NOT NULL DEFAULT '{}',
         current_step INT NOT NULL DEFAULT -1,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`, [])
      .then(() => pool.query(
        `CREATE INDEX IF NOT EXISTS idx_seq_enroll_lead ON sequence_enrollments(lead_id)`, []))
      .catch(e => { tableReady = null; console.error('sequence_enrollments init failed:', e.message); throw e; });
  }
  return tableReady;
}

// Umbrella swap for the day-16 step when owner_age < 60
// (spec: "Otherwise swap to: umbrella_liability pitch for the business" —
// copy drafted by Kimi, Dave to tune).
const UMBRELLA_SWAP = '{owner_name} - one gap I see on a lot of single-truck operations: the commercial auto policy covers the truck, but a bad accident can blow past those limits fast. An umbrella policy adds $1M on top for a few hundred a year. Worth a one-page quote? Reply YES and I will run it. - David Hughes, David Hughes Insurance';

function render(text, merge) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) =>
    (merge[k] !== undefined && merge[k] !== null) ? String(merge[k]) : m);
}

function htmlWrap(body) {
  const paras = String(body).split(/\n+/).filter(Boolean)
    .map(p => '<p style="margin:0 0 14px;">' + p + '</p>').join('');
  return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;font-size:15px;line-height:1.55;">'
    + '<div style="background:#1e3a5f;padding:16px 20px;"><b style="color:#fff;">David Hughes Insurance</b></div>'
    + '<div style="padding:20px;">' + paras + '</div></div>';
}

// Merge fields every enrollment gets for free.
function baseMerge(lead) {
  const config = require('../config');
  return {
    first_name: (lead.name || 'there').split(' ')[0],
    owner_name: lead.name || 'there',
    booking_link: config.CALENDLY_LINK || '',
    state: lead.state || ''
  };
}

async function isDnc(lead) {
  const or = [{ phone: lead.phone }];
  if (lead.email) or.push({ email: lead.email });
  const hit = await prisma.dncEntry.findFirst({ where: { OR: or } });
  return !!hit;
}

/**
 * Enroll a lead in a sequence. Stops any active enrollment of the same
 * sequence for that lead first (re-enroll = restart).
 * opts: { startAtDay, force } — force fires step 0 immediately, ignoring
 * its delay and quiet hours (test protocol only).
 */
async function enroll(lead, sequenceName, mergeFields = {}, opts = {}) {
  await ensureTable();
  const seq = loadSequence(sequenceName);
  await stopEnrollment(lead.id, 're-enrolled', sequenceName);

  const merge = { ...baseMerge(lead), ...mergeFields };
  const ins = await pool.query(
    `INSERT INTO sequence_enrollments (lead_id, sequence, merge) VALUES ($1, $2, $3::jsonb) RETURNING id`,
    [lead.id, sequenceName, JSON.stringify(merge)]);
  const enrollmentId = ins.rows[0].id;

  let startIdx = 0;
  if (opts.startAtDay !== undefined) {
    startIdx = seq.steps.findIndex(s => s.day === opts.startAtDay);
    if (startIdx < 0) startIdx = 0;
  }

  if (opts.force) {
    await fireStep(enrollmentId, startIdx, { force: true });
  } else {
    await scheduleStep(enrollmentId, startIdx, 0);
  }
  console.log(`📨 Enrolled ${lead.name} in ${sequenceName} (enrollment ${enrollmentId}, start step ${startIdx})`);
  return { enrollmentId, sequence: sequenceName, startStep: startIdx };
}

/** Stop automation for a lead. No sequenceName = stop ALL active tracks. */
async function stopEnrollment(leadId, reason, sequenceName = null) {
  await ensureTable();
  const r = sequenceName
    ? await pool.query(
        `UPDATE sequence_enrollments SET status='stopped', stop_reason=$3, updated_at=NOW()
         WHERE lead_id=$1 AND sequence=$2 AND status='active' RETURNING id`,
        [leadId, sequenceName, reason])
    : await pool.query(
        `UPDATE sequence_enrollments SET status='stopped', stop_reason=$2, updated_at=NOW()
         WHERE lead_id=$1 AND status='active' RETURNING id`,
        [leadId, reason]);
  if (r.rows.length) console.log(`⏹️ Stopped ${r.rows.length} enrollment(s) for lead ${leadId}: ${reason}`);
  return r.rows.length;
}

async function getEnrollments(leadId = null) {
  await ensureTable();
  const r = leadId
    ? await pool.query(`SELECT * FROM sequence_enrollments WHERE lead_id=$1 ORDER BY created_at DESC`, [leadId])
    : await pool.query(`SELECT * FROM sequence_enrollments ORDER BY created_at DESC LIMIT 200`, []);
  return r.rows;
}

/** Queue the Bull job for a step. delayHours is relative to NOW. */
async function scheduleStep(enrollmentId, stepIndex, delayHours) {
  const delay = Math.max(delayHours, 0) * 3600000;
  await callQueue.add('sequence-step', { enrollmentId, stepIndex }, { delay });
}

/**
 * Fire one step. Exported so enroll(force) and the Bull processor share it.
 * Returns a small result object for logs/tests.
 */
async function fireStep(enrollmentId, stepIndex, opts = {}) {
  await ensureTable();
  const seq = (await pool.query(`SELECT * FROM sequence_enrollments WHERE id=$1::uuid`, [enrollmentId])).rows[0];
  if (!seq || seq.status !== 'active') return { skipped: 'inactive' };

  const def = loadSequence(seq.sequence);
  const step = def.steps[stepIndex];
  if (!step) return { skipped: 'no_step' };

  const lead = await prisma.lead.findUnique({ where: { id: seq.lead_id } });
  if (!lead) { await stopEnrollment(seq.lead_id, 'lead_missing'); return { skipped: 'lead_missing' }; }

  // DNC re-check before every touch
  if (await isDnc(lead)) {
    await stopEnrollment(lead.id, 'dnc');
    return { skipped: 'dnc' };
  }

  // Quiet hours for message channels (vapi_call self-guards in the worker)
  if (!opts.force && step.channel !== 'vapi_call' && !isBusinessHours(lead.state)) {
    const next = getNextBusinessTime(lead.state);
    await callQueue.add('sequence-step', { enrollmentId, stepIndex },
      { delay: Math.max(next.getTime() - Date.now(), 60000) });
    return { rescheduled: next.toISOString() };
  }

  // Render body/subject: conditional step (trucking day 16) + vertical swaps
  const merge = { ...(seq.merge || {}) };
  let body = step.body || '';
  if (step.template === 'bridge_plan_60plus' && !(Number(merge.owner_age) >= 60)) {
    body = UMBRELLA_SWAP;
  }
  const branch = merge.vertical_branch && def.vertical_branches
    ? def.vertical_branches[merge.vertical_branch] : null;
  if (branch) {
    if (step.template === 'market_movement' && branch.swap_day_5) body += '\n\n' + branch.swap_day_5;
    if (step.template === 'quote_expiry' && branch.swap_day_9) body += '\n\n' + branch.swap_day_9;
  }
  const text = render(body, merge);
  const subject = step.subject ? render(step.subject, merge) : 'David Hughes Insurance';

  // Dispatch
  const sent = { channel: step.channel };
  if (step.channel === 'sms') {
    await brevoSMS(lead.phone, text);
  } else if (step.channel === 'email') {
    if (lead.email) await brevoEmail(lead.email, subject, htmlWrap(text));
    else sent.skippedEmail = 'no_email';
  } else if (step.channel === 'email+sms') {
    await brevoSMS(lead.phone, text);
    if (lead.email) await brevoEmail(lead.email, subject, htmlWrap(text));
    else sent.skippedEmail = 'no_email';
  } else if (step.channel === 'vapi_call') {
    await callQueue.add('make-call', { leadId: lead.id }, { priority: 5 });
    sent.vapi = 'queued';
  }

  await pool.query(
    `UPDATE sequence_enrollments SET current_step=$2, updated_at=NOW() WHERE id=$1::uuid`,
    [enrollmentId, stepIndex]);
  console.log(`📨 [${seq.sequence}] step ${stepIndex} (${step.template}, ${step.channel}) -> ${lead.name}`);

  // Schedule next step — or loop / complete
  const nextIdx = stepIndex + 1;
  if (nextIdx < def.steps.length) {
    const gap = (def.steps[nextIdx].day - step.day) * 24;
    await scheduleStep(enrollmentId, nextIdx, gap);
    sent.next = { stepIndex: nextIdx, inHours: gap };
  } else if (seq.sequence === 'trucking_cross_sell_v1') {
    // Quarterly loop: back to the day-28 step so audit calls land ~90d apart
    const loopIdx = def.steps.findIndex(s => s.day === 28);
    const cycleHours = (90 - (step.day - def.steps[loopIdx].day)) * 24;
    await scheduleStep(enrollmentId, loopIdx, cycleHours);
    sent.loop = { toStep: loopIdx, inHours: cycleHours };
  } else {
    await pool.query(
      `UPDATE sequence_enrollments SET status='completed', updated_at=NOW() WHERE id=$1::uuid`,
      [enrollmentId]);
    sent.done = true;
  }
  return sent;
}

// Bull processor — separate job name from 'make-call' on the shared queue
callQueue.process('sequence-step', 5, async (job) => {
  const { enrollmentId, stepIndex } = job.data;
  return fireStep(enrollmentId, stepIndex);
});
console.log('📨 Sequence engine registered (job: sequence-step, concurrency: 5)');

module.exports = { enroll, stopEnrollment, getEnrollments, fireStep, loadSequence };
