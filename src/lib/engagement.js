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
 *   DAVE_ALERT_EMAIL     where hot-lead alerts go (default askdave755@gmail.com)
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

function alertEmail() {
  return process.env.DAVE_ALERT_EMAIL || 'askdave755@gmail.com';
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
      .catch(e => { tableReady = null; console.error('lead_engagement init failed:', e.message); throw e; });
  }
  return tableReady;
}

async function recordEvent(leadId, event, meta = {}) {
  await ensureTable();
  await pool.query(
    `INSERT INTO lead_engagement (lead_id, event, meta) VALUES ($1, $2, $3::jsonb)`,
    [leadId, event, JSON.stringify(meta)]);
}

async function eventCounts(leadId) {
  await ensureTable();
  const r = await pool.query(
    `SELECT event, COUNT(*)::int AS n FROM lead_engagement WHERE lead_id=$1 GROUP BY event`,
    [leadId]);
  return Object.fromEntries(r.rows.map(row => [row.event, row.n]));
}

async function findLeadByEmail(email) {
  if (!email) return null;
  return prisma.lead.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' }
  });
}

// ── Apollo phone reveal ──
// POST /people/match with reveal_phone_number. Apollo delivers the number
// asynchronously to webhook_url (BASE_URL/webhook/apollo/phones). If it
// answers synchronously, we use that immediately.
async function revealPhone(lead) {
  const config = require('../config');
  if (!config.APOLLO_API_KEY) return { attempted: false, reason: 'no apollo key' };
  if (!config.BASE_URL) return { attempted: false, reason: 'BASE_URL not set — Apollo reveal needs a webhook callback' };

  const parts = (lead.name || '').trim().split(/\s+/);
  try {
    const res = await axios.post(
      'https://api.apollo.io/api/v1/people/match',
      {
        first_name: parts[0],
        last_name: parts.slice(1).join(' ') || undefined,
        organization_name: lead.company || undefined,
        email: lead.email || undefined,
        reveal_phone_number: true,
        webhook_url: `${config.BASE_URL}/webhook/apollo/phones?leadId=${lead.id}`
      },
      {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': config.APOLLO_API_KEY },
        timeout: 20000
      });

    const phones = res.data?.person?.phone_numbers || res.data?.phone_numbers || [];
    const sync = phones.map(pn => pn.sanitized_number || pn.raw_number).find(Boolean);
    console.log(`📞 Phone reveal requested for ${lead.name} (${lead.id}) — ${sync ? 'returned synchronously' : 'async via webhook'}`);
    return { attempted: true, syncPhone: sync || null };
  } catch (err) {
    console.error(`⚠️ Phone reveal failed for lead ${lead.id}:`, err.response?.status, JSON.stringify(err.response?.data || err.message));
    return { attempted: true, error: err.message };
  }
}

// Queue Brady for a warm follow-up call — DNC re-check first, always.
async function queueBradyCall(lead, reason) {
  const dnc = await prisma.dncEntry.findFirst({
    where: { OR: [{ phone: lead.phone }, ...(lead.email ? [{ email: lead.email }] : [])] }
  });
  if (dnc) {
    console.log(`🚫 Warm-call blocked by DNC: ${lead.name} (${lead.id})`);
    return { queued: false, reason: 'dnc' };
  }
  await callQueue.add('make-call', { leadId: lead.id }, { delay: 60000, priority: 1 });
  console.log(`🔥 Brady queued for warm call: ${lead.name} (${lead.id}) — ${reason}`);
  return { queued: true };
}

// ── escalation: engaged lead → task + Dave alert + phone reveal ──
async function escalate(lead, eventName, meta) {
  const counts = await eventCounts(lead.id);
  if (counts.escalated) return { skipped: 'already_escalated' };
  await recordEvent(lead.id, 'escalated', { trigger: eventName });

  await prisma.lead.update({ where: { id: lead.id }, data: { status: 'engaged' } });

  const label = `${lead.name} @ ${lead.company || 'unknown co'}`;
  await createTask({
    leadId: lead.id,
    type: 'FOLLOW_UP',
    title: `🔥 Engaged lead: ${label} ${eventName === 'click' ? 'clicked your link' : `opened ${counts.opened || 1}x`} — follow up today`,
    notes: `Email: ${lead.email} | Phone: ${lead.phone || 'not yet — reveal requested'} | Event: ${eventName}${meta?.link ? ` | Link: ${meta.link}` : ''}`,
    dueAt: new Date(Date.now() + 3600000),
    priority: 'hot'
  });

  await brevoEmail(
    alertEmail(),
    `🔥 Hot lead: ${label} just engaged`,
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
       <div style="background:#1e3a5f;padding:16px 20px;"><b style="color:#fff;">David Hughes Insurance — Hot Lead</b></div>
       <div style="padding:20px;">
         <p><b>${label}</b> just <b>${eventName === 'click' ? 'clicked your booking link' : 'opened your email ' + (counts.opened || 1) + ' times'}</b>.</p>
         <p>Email: ${lead.email}<br>Phone: ${lead.phone || 'reveal requested — Brady will call when it lands'}<br>State: ${lead.state || '?'}${meta?.link ? `<br>Clicked: ${meta.link}` : ''}</p>
         <p>Open the dashboard for details. A phone reveal has been requested automatically.</p>
       </div>
     </div>`);

  // If a phone already exists (rare for Apollo email-only leads), call now.
  if (lead.phone) {
    await queueBradyCall(lead, `engaged:${eventName}`);
    return { escalated: true, phone: 'existing', brady: 'queued' };
  }

  const reveal = await revealPhone(lead);
  if (reveal.syncPhone) {
    const phone = formatPhoneE164(reveal.syncPhone);
    if (phone) {
      await prisma.lead.update({ where: { id: lead.id }, data: { phone } });
      await queueBradyCall({ ...lead, phone }, 'engaged:sync_reveal');
      return { escalated: true, phone: 'revealed_sync', brady: 'queued' };
    }
  }
  return { escalated: true, phone: reveal.attempted ? 'reveal_pending' : 'reveal_failed', brady: 'waiting_on_phone' };
}

// ── Brevo transactional webhook ──
// Events: delivered, opened, unique_opened, click, hard_bounce, soft_bounce,
// unsubscribe, spam, invalid_email. Body: { event, email, link?, subject, ... }
async function handleBrevoEvent(body) {
  const event = String(body?.event || '').toLowerCase();
  const email = body?.email;
  if (!event || !email) return { processed: false, reason: 'missing event/email' };

  const lead = await findLeadByEmail(email);
  if (!lead) {
    console.log(`📭 Brevo ${event} for unknown email ${email}`);
    return { processed: false, reason: 'unknown_email', event };
  }

  const meta = { link: body.link, subject: body.subject, ts: body.ts_epoch || body.ts };
  await recordEvent(lead.id, event, meta);

  switch (event) {
    case 'unsubscribe':
    case 'spam': {
      await addToDnc({ phone: lead.phone || null, email: lead.email, reason: `Brevo ${event} event`, source: 'brevo_webhook' }, 'webhook:brevo');
      try {
        const { stopEnrollment } = require('./sequences');
        await stopEnrollment(lead.id, `brevo_${event}`);
      } catch (e) { console.warn('stopEnrollment failed:', e.message); }
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'compliance_hold', complianceStatus: 'blocked', complianceNotes: `DNC — Brevo ${event}` } });
      console.log(`🚫 ${event} from ${email} — DNC + sequence stopped`);
      return { processed: true, event, action: 'dnc' };
    }

    case 'hard_bounce':
    case 'invalid_email': {
      try {
        const { stopEnrollment } = require('./sequences');
        await stopEnrollment(lead.id, 'email_bounced');
      } catch (e) { console.warn('stopEnrollment failed:', e.message); }
      await prisma.lead.update({ where: { id: lead.id }, data: { status: 'bounced' } });
      return { processed: true, event, action: 'bounced' };
    }

    case 'click': {
      const r = await escalate(lead, 'click', meta);
      return { processed: true, event, action: 'escalated', ...r };
    }

    case 'opened':
    case 'unique_opened': {
      const counts = await eventCounts(lead.id);
      const opens = (counts.opened || 0) + (counts.unique_opened || 0);
      if (opens >= OPEN_ESCALATION_THRESHOLD && !counts.escalated) {
        const r = await escalate(lead, 'opened', meta);
        return { processed: true, event, opens, action: 'escalated', ...r };
      }
      return { processed: true, event, opens, action: 'logged' };
    }

    default:
      return { processed: true, event, action: 'logged' };
  }
}

// ── Apollo phone-reveal callback ──
// Apollo POSTs the revealed phone to the webhook_url we passed. We include
// ?leadId= in that URL so matching is exact; fall back to email/name+company.
async function handleApolloPhoneWebhook(body, leadIdFromQuery) {
  const person = body?.person || body || {};
  const phones = body?.phone_numbers || person.phone_numbers || [];
  const rawPhone = phones.map(pn => pn.sanitized_number || pn.raw_number).find(Boolean);
  const phone = formatPhoneE164(rawPhone);
  if (!phone) {
    console.warn('⚠️ Apollo phone webhook with no usable number:', JSON.stringify(body).slice(0, 300));
    return { processed: false, reason: 'no_phone_in_payload' };
  }

  let lead = leadIdFromQuery
    ? await prisma.lead.findUnique({ where: { id: leadIdFromQuery } })
    : await findLeadByEmail(person.email);
  if (!lead) {
    console.warn('⚠️ Apollo phone webhook: no matching lead', leadIdFromQuery, person.email);
    return { processed: false, reason: 'lead_not_found' };
  }

  await prisma.lead.update({ where: { id: lead.id }, data: { phone, status: lead.status === 'engaged' ? 'engaged' : lead.status } });
  await recordEvent(lead.id, 'phone_revealed', { phone: phone.slice(-4).padStart(phone.length, '*') });

  const r = await queueBradyCall({ ...lead, phone }, 'phone_revealed');
  await brevoEmail(
    alertEmail(),
    `📞 Number landed: ${lead.name} @ ${lead.company || 'unknown co'}`,
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
       <div style="background:#1e3a5f;padding:16px 20px;"><b style="color:#fff;">David Hughes Insurance — Brady Dialing</b></div>
       <div style="padding:20px;">
         <p>Apollo revealed a phone number for <b>${lead.name}</b> (${lead.email || 'no email'}).</p>
         <p>Brady is ${r.queued ? 'queued to call within the next business-hours window' : 'NOT calling (DNC block — check the lead)'}.</p>
       </div>
     </div>`);
  return { processed: true, brady: r.queued ? 'queued' : 'blocked' };
}

async function recentEngagement(limit = 100) {
  await ensureTable();
  const r = await pool.query(
    `SELECT * FROM lead_engagement ORDER BY created_at DESC LIMIT $1`, [limit]);
  return r.rows;
}

module.exports = { handleBrevoEvent, handleApolloPhoneWebhook, recordEvent, recentEngagement, revealPhone };
