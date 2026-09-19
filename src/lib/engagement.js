/**
 * engagement.js — Brevo engagement tracking + Apollo phone reveal.
 *
 * Email-only Apollo leads enter the commercial drip with no phone number.
 * This module closes the loop:
 *
 *   /webhook/brevo  -> handleBrevoEvent(body)
 *     - logs every event (lead_engagement table, raw SQL — no migration)
 *     - click, or 3rd open: ESCALATE — HOT task + alert email to Dave +
 *       Apollo phone reveal (async, result returns via /webhook/apollo/phones)
 *     - unsubscribe / spam: DNC hard stop + sequence stops
 *     - hard bounce: lead marked bounced, sequence stops
 *
 *   /webhook/apollo/phones -> handleApolloPhoneWebhook(body)
 *     - saves the revealed number to the lead, DNC re-check, then queues
 *       Brady (make-call). This is a WARM call — the lead engaged first.
 *
 * Env:
 *   OWNER_EMAIL          where hot-lead alerts go (default nexusgpartners@gmail.com; legacy DAVE_ALERT_EMAIL still honored)
 *   BREVO_WEBHOOK_SECRET if set, /webhook/brevo requires ?secret= match
 *   APOLLO_WEBHOOK_SECRET if set, phone-reveal webhook requires ?secret= match
 *   BASE_URL             required for the Apollo reveal webhook callback
 */

const axios = require('axios');
const prisma = require('../db');
const pool = require('./pool');
const { callQueue } = require('../queue');
const { brevoEmail } = require('./brevo');
const { addToDnc } = require('./compliance');
const { createTask } = require('./followup');
const { formatPhoneE164 } = require('./validate');

const OPEN_ESCALATION_THRESHOLD = 3;

// Owner notifications inbox — OWNER_EMAIL wins, legacy DAVE_ALERT_EMAIL still honored.
function alertEmail() {
  return process.env.OWNER_EMAIL || process.env.DAVE_ALERT_EMAIL || 'nexusgpartners@gmail.com';
}

// ── engagement table (lazy raw SQL — same pattern as sequence_enrollments) ──
let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = pool.query(
      `CREATE TABLE IF NOT EXISTS lead_engagement (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         lead_id TEXT NOT NULL,
         event TEXT NOT NULL,
         meta JSONB NOT NULL DEFAULT '{}',
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`, [])
      .then(() => pool.query(
        `CREATE INDEX IF NOT EXISTS idx_engagement_lead ON lead_engagement(lead_id)`, []))
      .catch(e => { tableReady = null; console.error('lead_engagement table:', e.message); throw e; });
  }
  return tableReady;
}

async function logEvent(leadId, event, meta = {}) {
  await ensureTable();
  await pool.query(
    `INSERT INTO lead_engagement (lead_id, event, meta) VALUES ($1, $2, $3)`,
    [leadId, event, JSON.stringify(meta)]);
}

// Brevo webhook payload shapes vary; normalize what we care about.
function parseBrevoEvent(body) {
  const event = String(body.event || '').toLowerCase();   // opened / click / unsubscribed / spam / hard_bounce ...
  const email = (body.email || '').toLowerCase().trim();
  return { event, email, raw: body };
}

async function handleBrevoEvent(body) {
  const { event, email } = parseBrevoEvent(body);
  if (!email) return { ignored: true, reason: 'no email' };

  const lead = await prisma.lead.findFirst({
    where: { email },
    orderBy: { createdAt: 'desc' }
  });
  if (!lead) return { ignored: true, reason: 'unknown email' };

  await logEvent(lead.id, event, body);

  // Hard stops first
  if (event.includes('unsubscribe') || event.includes('spam')) {
    await addToDnc({ phone: lead.phone, email }, 'brevo_webhook');
    await prisma.lead.update({ where: { id: lead.id }, data: {
      status: 'compliance_hold', complianceStatus: 'blocked',
      complianceNotes: `Brevo ${event} — self opt-out`
    }});
    return { leadId: lead.id, action: 'dnc' };
  }
  if (event.includes('hard_bounce')) {
    await prisma.lead.update({ where: { id: lead.id }, data: {
      complianceNotes: 'Email hard-bounced — address dead'
    }});
    return { leadId: lead.id, action: 'bounced' };
  }

  // Escalation: click, or 3rd open
  let opens = 0;
  if (event === 'opened' || event === 'open') {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM lead_engagement WHERE lead_id=$1 AND event IN ('opened','open')`,
      [lead.id]);
    opens = r.rows[0]?.n || 0;
  }
  const hot = event === 'click' || opens >= OPEN_ESCALATION_THRESHOLD;
  if (!hot) return { leadId: lead.id, action: 'logged' };

  // HOT: task + Dave alert + Apollo phone reveal (async webhook returns number)
  await createTask({
    leadId: lead.id,
    type: 'FOLLOW_UP',
    title: `🔥 ${lead.name || lead.company || email} ${event === 'click' ? 'CLICKED the link' : `opened ${opens}x`} — call now`,
    priority: 'hot',
    dueAt: new Date()
  });
  await brevoEmail(alertEmail(),
    `🔥 HOT: ${lead.company || lead.name || email} engaged`,
    `<p><b>${lead.name || ''}</b> (${lead.company || 'no company'}) just <b>${event}</b>.</p>` +
    `<p>Email: ${email}<br>Phone on file: ${lead.phone || 'none — requesting Apollo reveal'}</p>` +
    `<p>Call now while it's fresh.</p>`);

  if (!lead.phone && process.env.APOLLO_API_KEY) {
    try {
      const resp = await axios.post(
        'https://api.apollo.io/api/v1/mixed_people/search',
        { q_organization_name: lead.company, contact_email: email,
          webhook_url: `${process.env.BASE_URL}/webhook/apollo/phones`, per_page: 1 },
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'x-api-key': process.env.APOLLO_API_KEY } });
      console.log('Apollo phone reveal requested for', email, resp.status);
    } catch (e) {
      console.warn('Apollo reveal request failed:', e.message);
    }
  }
  return { leadId: lead.id, action: 'escalated', event, opens };
}

// Apollo delivers phone numbers here (async webhook from reveal request).
async function handleApolloPhoneWebhook(body) {
  const person = body.person || body.people?.[0] || body;
  const email = (person.email || '').toLowerCase().trim();
  const nums = person.phone_numbers || [];
  const rawNum = nums[0]?.sanitized_number || nums[0]?.raw_number || person.phone_number;
  const phone = rawNum ? formatPhoneE164(rawNum) : null;
  if (!email || !phone) return { ignored: true, reason: 'no email or phone in payload' };

  const lead = await prisma.lead.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } });
  if (!lead) return { ignored: true, reason: 'unknown email' };

  await prisma.lead.update({ where: { id: lead.id }, data: { phone } });
  await logEvent(lead.id, 'phone_revealed', { phone });

  // DNC re-check before dialing the fresh number
  const dnc = await prisma.dncEntry.findFirst({ where: { phone } });
  if (dnc) {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'compliance_hold', complianceStatus: 'blocked', complianceNotes: 'Revealed phone on DNC' } });
    return { leadId: lead.id, action: 'dnc_block' };
  }

  // Warm call — they engaged first, so dial promptly (business-hours gate lives in the worker)
  await callQueue.add('make-call', { leadId: lead.id }, { delay: 30000, priority: 1 });
  return { leadId: lead.id, action: 'queued', phone };
}

// Used by routes to enrich lead detail views.
async function recentEngagement(leadId, limit = 10) {
  await ensureTable();
  const r = await pool.query(
    `SELECT event, meta, created_at FROM lead_engagement WHERE lead_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [leadId, limit]);
  return r.rows;
}

module.exports = { handleBrevoEvent, handleApolloPhoneWebhook, recentEngagement, logEvent };
