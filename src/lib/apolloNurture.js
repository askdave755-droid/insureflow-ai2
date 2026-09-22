/**
 * Apollo nurture layer for positive/completed call outcomes.
 *
 * Env:
 *   APOLLO_API_KEY
 *   APOLLO_SEND_EMAIL_ACCOUNT_ID
 *   APOLLO_SEQUENCE_ID_COMMERCIAL_AUTO / APOLLO_SEQUENCE_ID_LIFE_FE
 *   APOLLO_SEQUENCE_ID_DEFAULT (fallback)
 * Optional: APOLLO_NURTURE_LIST_PREFIX (default nurture),
 * APOLLO_NURTURE_DISPOSITIONS (CSV), APOLLO_NURTURE_ENABLE=0 kill switch.
 */
const axios = require('axios');
const prisma = require('../db');
const pool = require('./pool');
const { brevoEmail } = require('./brevo');

const BASE = 'https://api.apollo.io/api/v1';
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'nexusgpartners@gmail.com';
const POSITIVE = new Set((process.env.APOLLO_NURTURE_DISPOSITIONS ||
  'booked,interested,qualified,callback,appointment,requested_callback,completed')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const NEGATIVE = new Set(['dnc', 'not_interested', 'no_answer', 'unknown']);
let tableReady = null;
const warned = new Set();

const warnOnce = (key, msg) => { if (!warned.has(key)) { warned.add(key); console.warn(msg); } };
const txt = v => { try { return JSON.stringify(v || {}); } catch (_) { return String(v || ''); } };
const headers = () => ({
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache',
  accept: 'application/json',
  'x-api-key': process.env.APOLLO_API_KEY
});

function verticalKey(v) {
  return String(v || 'commercial_auto').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'commercial_auto';
}
function listNameFor(v) {
  const p = String(process.env.APOLLO_NURTURE_LIST_PREFIX || 'nurture')
    .trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'nurture';
  return `${p}-${verticalKey(v)}`;
}
function sequenceIdFor(v) {
  const k = verticalKey(v).toUpperCase();
  return process.env[`APOLLO_SEQUENCE_ID_${k}`]
    || (k === 'COMMERCIAL_AUTO' ? process.env.APOLLO_SEQUENCE_ID_COMMERCIAL : null)
    || (k === 'LIFE_FE' ? process.env.APOLLO_SEQUENCE_ID_LIFE : null)
    || process.env.APOLLO_NURTURE_SEQUENCE_ID
    || process.env.APOLLO_SEQUENCE_ID_DEFAULT
    || process.env.APOLLO_SEQUENCE_ID || null;
}
const senderId = () => process.env.APOLLO_SEND_EMAIL_ACCOUNT_ID
  || process.env.APOLLO_SENDER_EMAIL_ACCOUNT_ID
  || process.env.APOLLO_EMAIL_ACCOUNT_ID || null;

async function ensureTable() {
  if (!tableReady) {
    tableReady = pool.query(`CREATE TABLE IF NOT EXISTS apollo_nurture_enrollments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id TEXT NOT NULL,
      email TEXT NOT NULL,
      vertical TEXT NOT NULL,
      list_name TEXT NOT NULL,
      apollo_contact_id TEXT,
      sequence_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      enrolled_at TIMESTAMPTZ,
      replied_at TIMESTAMPTZ,
      stopped_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`, [])
      .then(() => pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS apollo_nurture_enrollments_lead_seq_key ON apollo_nurture_enrollments(lead_id, sequence_id)`, []))
      .then(() => pool.query(`CREATE INDEX IF NOT EXISTS idx_apollo_nurture_email ON apollo_nurture_enrollments(lower(email))`, []))
      .then(() => pool.query(`CREATE INDEX IF NOT EXISTS idx_apollo_nurture_contact ON apollo_nurture_enrollments(apollo_contact_id)`, []))
      .catch(e => { tableReady = null; throw e; });
  }
  return tableReady;
}

function shouldEnroll(lead, outcome = {}) {
  if (process.env.APOLLO_NURTURE_ENABLE === '0') return { ok: false, reason: 'disabled' };
  const email = String(lead.email || '').trim().toLowerCase();
  if (!email) return { ok: false, reason: 'no_email' };
  const d = String(outcome.disposition || lead.lastDisposition || '').trim().toLowerCase();
  if (NEGATIVE.has(d)) return { ok: false, reason: `excluded_${d}` };
  if (outcome.qualified === true || lead.qualified === true || POSITIVE.has(d)) return { ok: true, email, disposition: d || 'qualified' };
  return { ok: false, reason: `not_positive_${d || 'missing'}` };
}

async function isDnc(lead, email) {
  if (lead.complianceStatus === 'blocked') return true;
  const OR = [];
  if (lead.phone) OR.push({ phone: lead.phone });
  if (email) OR.push({ email });
  return OR.length ? !!(await prisma.dncEntry.findFirst({ where: { OR } })) : false;
}

async function claim(lead, email, vertical, listName, sequenceId) {
  await ensureTable();
  const found = await pool.query(
    `SELECT * FROM apollo_nurture_enrollments WHERE lead_id=$1 AND sequence_id=$2 LIMIT 1`,
    [lead.id, sequenceId]);
  const row = found.rows[0];
  if (row && ['active', 'replied', 'stopped', 'skipped'].includes(row.status)) {
    return { claimed: false, enrollment: row, reason: `already_${row.status}` };
  }
  if (row && row.status === 'pending') {
    const age = Date.now() - new Date(row.updated_at || row.created_at).getTime();
    if (age < 10 * 60 * 1000) return { claimed: false, enrollment: row, reason: 'already_pending' };
  }
  if (row) {
    const retried = await pool.query(
      `UPDATE apollo_nurture_enrollments
       SET email=$2, vertical=$3, list_name=$4, status='pending', last_error=NULL, updated_at=NOW()
       WHERE id=$1::uuid RETURNING *`,
      [row.id, email, vertical, listName]);
    return { claimed: true, enrollment: retried.rows[0] };
  }
  const inserted = await pool.query(
    `INSERT INTO apollo_nurture_enrollments (lead_id,email,vertical,list_name,sequence_id,status)
     VALUES ($1,$2,$3,$4,$5,'pending')
     ON CONFLICT (lead_id,sequence_id) DO NOTHING RETURNING *`,
    [lead.id, email, vertical, listName, sequenceId]);
  if (inserted.rows[0]) return { claimed: true, enrollment: inserted.rows[0] };
  const raced = await pool.query(
    `SELECT * FROM apollo_nurture_enrollments WHERE lead_id=$1 AND sequence_id=$2 LIMIT 1`,
    [lead.id, sequenceId]);
  return { claimed: false, enrollment: raced.rows[0] || null, reason: 'already_enrolled' };
}

function names(lead) {
  const p = String(lead.name || '').trim().split(/\s+/).filter(Boolean);
  return { first: p.shift() || String(lead.company || 'Owner').split(/\s+/)[0], last: p.join(' ') || '—' };
}

async function findContact(email) {
  const r = await axios.post(`${BASE}/contacts/search`, { q_keywords: email, page: 1, per_page: 10 },
    { headers: headers(), timeout: 20000 });
  return (r.data?.contacts || []).find(c =>
    [c.email, ...((c.contact_emails || []).map(e => e && e.email))]
      .filter(Boolean).map(e => String(e).toLowerCase()).includes(email)) || null;
}

async function resolveContact(lead, email) {
  const existing = await findContact(email);
  if (existing?.id) return { contact: existing, created: false };
  const n = names(lead);
  const r = await axios.post(`${BASE}/contacts`, {
    first_name: n.first,
    last_name: n.last,
    email,
    organization_name: lead.company || undefined,
    title: lead.title || undefined,
    direct_phone: lead.phone || undefined,
    present_raw_address: [lead.city, lead.state].filter(Boolean).join(', ') || undefined,
    run_dedupe: true
  }, { headers: headers(), timeout: 20000 });
  const contact = r.data?.contact || r.data;
  if (!contact?.id) throw new Error('Apollo contact create returned no id');
  return { contact, created: true };
}

async function createList(listName) {
  try {
    await axios.post(`${BASE}/labels`, { name: listName, modality: 'contacts' },
      { headers: headers(), timeout: 20000 });
  } catch (e) {
    if (e.response?.status !== 422) throw e; // 422 = already exists
  }
}

async function addToList(contactId, listName) {
  const body = { entity_ids: [contactId], label_names: [listName], modality: 'contacts', async: false };
  try {
    return await axios.post(`${BASE}/labels/add_entity_ids_to_label_names`, body,
      { headers: headers(), timeout: 20000 });
  } catch (e) {
    if (![400, 404, 422].includes(e.response?.status)) throw e;
    await createList(listName);
    return axios.post(`${BASE}/labels/add_entity_ids_to_label_names`, body,
      { headers: headers(), timeout: 20000 });
  }
}

async function addToSequence(contactId, sequenceId) {
  const sender = senderId();
  if (!sender) {
    warnOnce('sender', '⚠️ Apollo nurture: APOLLO_SEND_EMAIL_ACCOUNT_ID not set — sequence enrollment skipped');
    return { skipped: 'missing_sender_account' };
  }
  try {
    const r = await axios.post(`${BASE}/emailer_campaigns/${encodeURIComponent(sequenceId)}/add_contact_ids`, {
      emailer_campaign_id: sequenceId,
      contact_ids: [contactId],
      send_email_from_email_account_id: sender,
      async: false,
      sequence_no_email: false,
      sequence_unverified_email: false,
      sequence_active_in_other_campaigns: false,
      sequence_finished_in_other_campaigns: false,
      sequence_same_company_in_same_campaign: false
    }, { headers: headers(), timeout: 30000 });
    return { enrolled: true, response: r.data };
  } catch (e) {
    const t = `${e.response?.data ? txt(e.response.data) : ''} ${e.message}`.toLowerCase();
    if (/already|in this sequence|active in this campaign|previously enrolled/.test(t)) {
      return { enrolled: true, already: true, response: e.response?.data || null };
    }
    if (/active in other|other campaign|another sequence|another campaign/.test(t)) {
      return { skipped: 'active_in_other_sequence', status: e.response?.status, response: e.response?.data || null };
    }
    throw e;
  }
}

async function markError(id, e) {
  if (!id) return;
  await pool.query(
    `UPDATE apollo_nurture_enrollments SET status='error', last_error=$2, updated_at=NOW() WHERE id=$1::uuid`,
    [id, String(e.response?.data ? txt(e.response.data) : e.message).slice(0, 500)]).catch(() => {});
}

async function enrollLeadInNurture(lead, outcome = {}) {
  const gate = shouldEnroll(lead, outcome);
  if (!gate.ok) return { skipped: gate.reason };
  const email = gate.email;
  const vertical = verticalKey(lead.vertical || outcome.vertical);
  const listName = listNameFor(vertical);
  const sequenceId = sequenceIdFor(vertical);
  if (!process.env.APOLLO_API_KEY) {
    warnOnce('key', '⚠️ Apollo nurture: APOLLO_API_KEY not set — enrollment skipped');
    return { skipped: 'missing_apollo_key', listName };
  }
  if (!sequenceId) {
    warnOnce(`seq-${vertical}`, `⚠️ Apollo nurture: no sequence ID for ${vertical} — set APOLLO_SEQUENCE_ID_${vertical.toUpperCase()} or APOLLO_SEQUENCE_ID_DEFAULT`);
    return { skipped: 'missing_sequence_id', vertical, listName };
  }
  if (await isDnc(lead, email)) return { skipped: 'dnc', email };

  let enrollment = null;
  try {
    const c = await claim(lead, email, vertical, listName, sequenceId);
    enrollment = c.enrollment;
    if (!c.claimed) return { skipped: c.reason || 'already_enrolled', email, listName, sequenceId };

    const { contact, created } = await resolveContact(lead, email);
    const contactId = contact.id || contact._id;
    await addToList(contactId, listName);
    const seq = await addToSequence(contactId, sequenceId);
    if (seq.skipped) {
      await pool.query(
        `UPDATE apollo_nurture_enrollments SET apollo_contact_id=$2, list_name=$3, status='skipped', last_error=$4, updated_at=NOW() WHERE id=$1::uuid`,
        [enrollment.id, contactId, listName, seq.skipped]);
      return { skipped: seq.skipped, email, contactId, listName, sequenceId };
    }
    await pool.query(
      `UPDATE apollo_nurture_enrollments SET apollo_contact_id=$2, status='active', last_error=NULL, enrolled_at=NOW(), updated_at=NOW() WHERE id=$1::uuid`,
      [enrollment.id, contactId]);
    console.log(`📧 Apollo nurture: ${lead.name || email} → ${listName} + sequence ${sequenceId}${seq.already ? ' (already enrolled)' : ''}${created ? ' (new contact)' : ''}`);
    return { enrolled: true, already: !!seq.already, createdContact: created, email, contactId, listName, sequenceId };
  } catch (e) {
    await markError(enrollment?.id, e);
    console.warn(`⚠️ Apollo nurture failed for ${lead.name || email}: ${e.response?.status || ''} ${e.response?.data ? txt(e.response.data).slice(0, 300) : e.message}`);
    return { error: e.message, email, listName, sequenceId };
  }
}

const firstString = (...vals) => vals.find(v => typeof v === 'string' && v.trim())?.trim() || null;

function normalizeReply(body = {}) {
  const data = body.data || body.payload || body;
  const contact = data.contact || body.contact || data.person || body.person || {};
  const msg = data.message || data.email || data.email_message || body.message || {};
  const event = firstString(data.event, data.type, data.event_type, body.event, body.type, body.event_type, msg.event, msg.type, data.action, body.action);
  if (event && !/reply|replied/i.test(event)) return { ignored: true, event };
  const email = firstString(contact.email, data.contact_email, data.email, body.email, msg.from?.email, msg.from, msg.reply_from, data.reply?.from?.email);
  const contactId = firstString(contact.id, contact._id, data.contact_id, body.contact_id, data.apollo_contact_id, msg.contact_id, data.contact?.id);
  const sequenceId = firstString(data.sequence_id, body.sequence_id, data.emailer_campaign_id, body.emailer_campaign_id, msg.emailer_campaign_id, data.sequence?.id, body.sequence?.id);
  return { event: event || 'replied', email: email?.toLowerCase() || null, contactId, sequenceId, raw: body };
}

async function replyContext(evt) {
  await ensureTable();
  let enrollment = null;
  if (evt.contactId && evt.email) {
    enrollment = (await pool.query(`SELECT * FROM apollo_nurture_enrollments WHERE apollo_contact_id=$1 OR lower(email)=lower($2) ORDER BY updated_at DESC LIMIT 1`, [evt.contactId, evt.email])).rows[0] || null;
  } else if (evt.contactId) {
    enrollment = (await pool.query(`SELECT * FROM apollo_nurture_enrollments WHERE apollo_contact_id=$1 ORDER BY updated_at DESC LIMIT 1`, [evt.contactId])).rows[0] || null;
  } else if (evt.email) {
    enrollment = (await pool.query(`SELECT * FROM apollo_nurture_enrollments WHERE lower(email)=lower($1) ORDER BY updated_at DESC LIMIT 1`, [evt.email])).rows[0] || null;
  }
  let lead = enrollment?.lead_id
    ? await prisma.lead.findUnique({ where: { id: enrollment.lead_id } }).catch(() => null)
    : null;
  if (!lead && evt.email) lead = await prisma.lead.findFirst({ where: { email: evt.email }, orderBy: { createdAt: 'desc' } });
  return { enrollment, lead };
}

async function stopSequence(contactId, sequenceId) {
  if (!process.env.APOLLO_API_KEY) return { skipped: 'missing_apollo_key' };
  if (!contactId || !sequenceId) return { skipped: 'missing_contact_or_sequence' };
  let last = null;
  for (const body of [
    { emailer_campaign_ids: [sequenceId], contact_ids: [contactId], mode: 'stop' },
    { emailer_campaign_id: sequenceId, contact_ids: [contactId], mode: 'stop' }
  ]) {
    try {
      const r = await axios.post(`${BASE}/emailer_campaigns/remove_or_stop_contact_ids`, body,
        { headers: headers(), timeout: 30000 });
      return { stopped: true, response: r.data };
    } catch (e) {
      last = e;
      if (![400, 404, 422].includes(e.response?.status)) throw e;
    }
  }
  throw last;
}

async function handleApolloReplyWebhook(body = {}) {
  const evt = normalizeReply(body);
  if (evt.ignored) return { ignored: true, event: evt.event };
  if (!evt.email && !evt.contactId) return { ignored: true, reason: 'no email or Apollo contact id' };
  const { enrollment, lead } = await replyContext(evt);
  if (!lead) return { ignored: true, reason: 'unknown lead', email: evt.email, contactId: evt.contactId };

  const contactId = evt.contactId || enrollment?.apollo_contact_id || null;
  const sequenceId = evt.sequenceId || enrollment?.sequence_id || null;
  let stop = { skipped: 'not_enrolled_locally' };
  let stopError = null;
  if (contactId && sequenceId) {
    try { stop = await stopSequence(contactId, sequenceId); }
    catch (e) {
      stopError = String(e.response?.data ? txt(e.response.data) : e.message).slice(0, 500);
      stop = { error: stopError };
    }
  }

  const data = { lastDisposition: 'apollo_reply' };
  if (lead.status !== 'compliance_hold') data.status = 'replied';
  await prisma.lead.update({ where: { id: lead.id }, data });
  if (enrollment) {
    await pool.query(
      `UPDATE apollo_nurture_enrollments SET status='replied', last_error=$2, replied_at=NOW(), stopped_at=NOW(), updated_at=NOW() WHERE id=$1::uuid`,
      [enrollment.id, stopError]).catch(() => {});
  }
  await prisma.task.create({
    data: {
      leadId: lead.id,
      type: 'FOLLOW_UP',
      title: `📩 Apollo reply: ${lead.name || lead.company || evt.email} — read and respond now`,
      notes: `Apollo sequence reply. Email: ${evt.email || lead.email || 'unknown'} | Sequence: ${sequenceId || 'unknown'} | Apollo contact: ${contactId || 'unknown'}`,
      dueAt: new Date(),
      priority: 'hot'
    }
  }).catch(e => console.warn('⚠️ Apollo reply task failed:', e.message));
  try {
    await brevoEmail(OWNER_EMAIL, `📩 APOLLO REPLY: ${lead.name || lead.company || evt.email}`,
      `<p><b>${lead.name || ''}</b> (${lead.company || 'no company'}) replied to Apollo nurture.</p>` +
      `<p>Email: ${evt.email || lead.email || 'unknown'}<br>Phone: ${lead.phone || 'unknown'}<br>Lead status: <b>${data.status || lead.status}</b>.</p>`);
  } catch (e) { console.warn('⚠️ Apollo reply owner alert failed:', e.message); }
  console.log(`📩 Apollo reply: ${lead.name || lead.id} → ${data.status || lead.status}; stop=${stop.stopped ? 'ok' : stop.skipped || 'attempted'}`);
  return { received: true, leadId: lead.id, status: data.status || lead.status, contactId, sequenceId, stop, stopError };
}

module.exports = { enrollLeadInNurture, handleApolloReplyWebhook, listNameFor, sequenceIdFor, shouldEnroll };
