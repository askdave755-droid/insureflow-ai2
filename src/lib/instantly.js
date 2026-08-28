// ─── INSTANTLY AI — AGENCY CLIENT ACQUISITION ONLY ───────────────────
// Instantly is used to acquire insurance-agent CLIENTS (agencies that want
// InsureFlowAI to qualify their leads). It is NOT used to dial or email
// insurance prospects — that path stays in Vapi/Brevo with full compliance.
//
// Everything in this module is defensive: no function ever throws into the
// request path. Failures are logged and returned as { ok: false, error }.
//
// Prisma is required lazily so this module is importable in smoke tests
// without a generated client, live DB, Redis, or server boot.
const axios = require('axios');
const config = require('../config');

function db() {
  // Lazy require — keeps `require('./instantly')` side-effect free.
  return require('../db');
}

// Phase 1 AgencyProspect statuses (strings, validated here — not an enum).
const AGENCY_PROSPECT_STATUSES = [
  'new', 'contacted', 'replied', 'qualified',
  'booked', 'client', 'unsubscribed', 'bounced'
];

// Instantly webhook event_type → AgencyProspect status. Unknown events keep
// the existing status (only lastEvent is updated).
const EVENT_STATUS_MAP = {
  email_sent: 'contacted',
  email_opened: 'contacted',
  email_link_clicked: 'contacted',
  email_replied: 'replied',
  reply_received: 'replied',
  lead_interested: 'qualified',
  lead_meeting_booked: 'booked',
  lead_neutral: null,
  lead_not_interested: 'unsubscribed',
  lead_unsubscribed: 'unsubscribed',
  email_bounced: 'bounced',
  campaign_completed: null
};

function instantlyConfigured() {
  return Boolean(config.INSTANTLY_API_KEY && config.INSTANTLY_API_BASE_URL);
}

// ─── Event normalization ─────────────────────────────────────────────
// Handles the common Instantly webhook shapes:
//   A) { event_type, lead: { email, first_name, last_name, ... }, campaign_id }
//   B) flat { email, first_name, last_name, campaign_id, status, ... }
// Returns null when no usable email is present.
function normalizeInstantlyEvent(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const lead = (payload.lead && typeof payload.lead === 'object') ? payload.lead : payload;
  const email = lead.email || payload.email;
  if (!email || typeof email !== 'string') return null;

  const eventType = payload.event_type || payload.event || payload.type || null;

  // Status: explicit status field wins if it's a known Phase 1 status,
  // otherwise map the event type; null means "leave status unchanged".
  let status = null;
  const rawStatus = payload.status || lead.status;
  if (rawStatus && AGENCY_PROSPECT_STATUSES.includes(String(rawStatus).toLowerCase())) {
    status = String(rawStatus).toLowerCase();
  } else if (eventType && Object.prototype.hasOwnProperty.call(EVENT_STATUS_MAP, eventType)) {
    status = EVENT_STATUS_MAP[eventType];
  }

  return {
    email: email.trim().toLowerCase(),
    firstName: lead.first_name || lead.firstName || null,
    lastName: lead.last_name || lead.lastName || null,
    agencyName: lead.company_name || lead.company || lead.agency_name || lead.agencyName || null,
    phone: lead.phone || null,
    state: lead.state || null,
    status,
    eventType,
    instantlyLeadId: payload.lead_id || payload.instantly_lead_id || lead.id || lead.lead_id || null,
    instantlyCampaignId: payload.campaign_id || payload.instantly_campaign_id || lead.campaign_id || null,
    lastEvent: eventType || rawStatus || null
  };
}

// ─── Upsert from webhook event ───────────────────────────────────────
// Creates/updates the AgencyProspect and opens a follow-up Task for Dave
// when the prospect replies or is qualified. Never throws.
async function upsertAgencyProspectFromEvent(event, opts = {}) {
  try {
    const normalized = event && event.email ? event : normalizeInstantlyEvent(event);
    if (!normalized) {
      return { ok: false, error: 'Unrecognized Instantly event shape (no email)' };
    }

    const prisma = db();
    const data = {
      firstName: normalized.firstName,
      lastName: normalized.lastName,
      agencyName: normalized.agencyName,
      phone: normalized.phone,
      state: normalized.state,
      instantlyLeadId: normalized.instantlyLeadId,
      instantlyCampaignId: normalized.instantlyCampaignId,
      lastEvent: normalized.lastEvent,
      clientId: opts.clientId || null
    };
    // Drop undefined/null-ish fields we don't want to overwrite with null.
    for (const key of Object.keys(data)) {
      if (data[key] === null || data[key] === undefined) delete data[key];
    }
    if (normalized.status) data.status = normalized.status;

    const prospect = await prisma.agencyProspect.upsert({
      where: { email: normalized.email },
      create: { email: normalized.email, status: normalized.status || 'new', ...data },
      update: data
    });

    let task = null;
    const effectiveStatus = normalized.status || prospect.status;
    if (effectiveStatus === 'replied' || effectiveStatus === 'qualified') {
      const name = [prospect.firstName, prospect.lastName].filter(Boolean).join(' ') || prospect.email;
      task = await prisma.task.create({
        data: {
          type: 'FOLLOW_UP',
          title: `Instantly: ${name} ${effectiveStatus} — follow up`,
          notes: `AgencyProspect ${prospect.id} (${prospect.email}) event "${prospect.lastEvent || effectiveStatus}"`
            + (prospect.agencyName ? ` from ${prospect.agencyName}` : '')
            + (prospect.instantlyCampaignId ? ` [campaign ${prospect.instantlyCampaignId}]` : ''),
          priority: effectiveStatus === 'qualified' ? 'hot' : 'high',
          status: 'open',
          clientId: prospect.clientId || null
        }
      });
      console.log(`📬 Instantly ${effectiveStatus}: follow-up Task ${task.id} for ${prospect.email}`);
    }

    return { ok: true, prospect, task };
  } catch (err) {
    console.error('❌ upsertAgencyProspectFromEvent failed:', err.message);
    return { ok: false, error: err.message };
  }
}

// ─── Outbound push (DISABLED by default) ─────────────────────────────
// Pushing prospects OUT to Instantly campaigns is opt-in via
// INSTANTLY_PUSH_ENABLED=true. Until enabled this is a safe no-op.
// Never throws into the request path.
async function pushAgencyProspect(prospect) {
  try {
    if (config.INSTANTLY_PUSH_ENABLED !== 'true') {
      return { ok: false, skipped: true, reason: 'INSTANTLY_PUSH_ENABLED is not true' };
    }
    if (!instantlyConfigured()) {
      return { ok: false, skipped: true, reason: 'Instantly not configured (missing INSTANTLY_API_KEY)' };
    }

    // NOTE: adjust endpoint/body to the exact Instantly campaign-lead API in
    // use (e.g. POST /lead/add or /leads with campaign_id) before enabling.
    const resp = await axios.post(
      `${config.INSTANTLY_API_BASE_URL}/lead/add`,
      {
        // campaign: process.env.INSTANTLY_CAMPAIGN_ID,
        email: prospect.email,
        first_name: prospect.firstName,
        last_name: prospect.lastName,
        company_name: prospect.agencyName,
        phone: prospect.phone
      },
      {
        headers: { Authorization: `Bearer ${config.INSTANTLY_API_KEY}` },
        timeout: 10000
      }
    );
    return { ok: true, status: resp.status, data: resp.data };
  } catch (err) {
    console.error('❌ pushAgencyProspect failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  AGENCY_PROSPECT_STATUSES,
  EVENT_STATUS_MAP,
  instantlyConfigured,
  normalizeInstantlyEvent,
  upsertAgencyProspectFromEvent,
  pushAgencyProspect
};
