// ─── COMPLIANCE ENGINE (Phase 1) ─────────────────────────────────────
// The question this module answers:
//
//   "Can InsureFlow legally/appropriately contact this prospect through
//    this channel, at this time, in this jurisdiction, under this campaign?"
//
// Business hours ≠ permission. Every outreach decision calls
// checkContactPermission() FIRST and records the outcome.
//
// Checks (in order — first hard stop wins):
//   1. Licensed state       — we only solicit where Dave holds an active
//                             P&C license (config.ALLOWED_STATES).
//   2. DNC list             — phone/email on our internal do-not-contact
//                             list → permanently blocked until removed.
//   3. Channel consent      — automated SMS requires prior express
//                             consent (TCPA). Cold voice calls to business
//                             landlines are permitted; cell-only + auto-dial
//                             is the risk area, so 'sms' is strict, 'call'
//                             is allowed with hours, 'email' follows CAN-SPAM.
//   4. Contact window       — 7am–8pm in the PROSPECT'S local time zone
//                             (delegates to lib/validate isBusinessHours).
//
// Result: { allowed: bool, status: 'clear'|'hold'|'blocked', reasons: [] }
//   clear   → proceed now
//   hold    → not now (outside hours, missing consent) — retry/queue later
//   blocked → do not contact (DNC, unlicensed state) — needs manual action

const prisma = require('../db');
const config = require('../config');
const { isBusinessHours, getNextBusinessTime } = require('./validate');
const { audit } = require('./audit');

async function checkContactPermission(lead, channel = 'call', actor = 'system') {
  const reasons = [];

  // 1. Licensed-state gate
  if (!config.ALLOWED_STATES.includes((lead.state || '').toUpperCase())) {
    reasons.push(`State ${lead.state || '??'} not in licensed states [${config.ALLOWED_STATES.join(', ')}]`);
    const result = { allowed: false, status: 'blocked', reasons };
    await recordDecision(lead, channel, result, actor);
    return result;
  }

  // 2. Internal DNC
  const dnc = await prisma.dncEntry.findFirst({
    where: {
      OR: [
        lead.phone ? { phone: lead.phone } : undefined,
        lead.email ? { email: lead.email } : undefined
      ].filter(Boolean)
    }
  });
  if (dnc) {
    reasons.push(`On internal DNC list (${dnc.source}${dnc.reason ? ': ' + dnc.reason : ''})`);
    const result = { allowed: false, status: 'blocked', reasons };
    await recordDecision(lead, channel, result, actor);
    return result;
  }

  // 3. Channel consent
  if (channel === 'sms') {
    const consent = await prisma.consentEvent.findFirst({
      where: { phone: lead.phone, channel: 'sms', granted: true },
      orderBy: { capturedAt: 'desc' }
    });
    if (!consent) {
      reasons.push('No prior express SMS consent on file (TCPA) — hold for manual first touch');
      const result = { allowed: false, status: 'hold', reasons };
      await recordDecision(lead, channel, result, actor);
      return result;
    }
  }

  // 4. Contact window (prospect local time)
  if (!isBusinessHours(lead.state)) {
    const nextTime = getNextBusinessTime(lead.state);
    reasons.push(`Outside contact window (7am–8pm prospect local). Next allowed: ${new Date(nextTime).toISOString()}`);
    const result = { allowed: false, status: 'hold', reasons, retryAt: new Date(nextTime) };
    await recordDecision(lead, channel, result, actor);
    return result;
  }

  const result = { allowed: true, status: 'clear', reasons: [] };
  await recordDecision(lead, channel, result, actor);
  return result;
}

// Persist the decision on the lead AND in the audit trail so we can prove
// what the system knew when it chose to (not) contact someone.
async function recordDecision(lead, channel, result, actor) {
  try {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        complianceStatus: result.status,
        complianceNotes: `[${channel}] ${result.status.toUpperCase()} — ${result.reasons.join('; ') || 'all checks passed'}`
      }
    });
  } catch (err) {
    console.warn(`⚠️ compliance status write failed for lead ${lead.id}:`, err.message);
  }
  if (result.status !== 'clear') {
    await audit({
      actor,
      action: result.status === 'blocked' ? 'contact_blocked' : 'contact_held',
      entityType: 'Lead',
      entityId: lead.id,
      metadata: { channel, reasons: result.reasons }
    });
  }
}

// Add phone/email to internal DNC. Called from SMS STOP handlers, call
// opt-outs, or manually. Idempotent.
async function addToDnc({ phone = null, email = null, reason = null, source = 'manual' }, actor = 'system') {
  const existing = await prisma.dncEntry.findFirst({
    where: { OR: [phone ? { phone } : undefined, email ? { email } : undefined].filter(Boolean) }
  });
  if (existing) return existing;
  const entry = await prisma.dncEntry.create({ data: { phone, email, reason, source } });
  await audit({ actor, action: 'dnc_added', entityType: 'DncEntry', entityId: entry.id, after: { phone, email, reason, source } });
  return entry;
}

// ─── DIAL-TIME DNC RECHECK (SPEC §6) ────────────────────────────────
// Runs in the call worker immediately BEFORE makeCall, even if queue-time
// compliance passed earlier (DNC may have been added while the job sat in
// Redis). Force mode may skip business hours but NEVER this check.
// Checks: lead.complianceStatus === 'blocked', and internal DNC by
// phone/email. A blocked lead is put on compliance_hold + audited and the
// call is not placed.
async function recheckDncAtDialTime(lead, actor = 'worker:call') {
  const reasons = [];

  if ((lead.complianceStatus || '').toLowerCase() === 'blocked') {
    reasons.push(`Lead complianceStatus=blocked (${lead.complianceNotes || 'no notes'})`);
  }

  const dnc = await prisma.dncEntry.findFirst({
    where: {
      OR: [
        lead.phone ? { phone: lead.phone } : undefined,
        lead.email ? { email: lead.email } : undefined
      ].filter(Boolean)
    }
  });
  if (dnc) {
    reasons.push(`On internal DNC list (${dnc.source}${dnc.reason ? ': ' + dnc.reason : ''})`);
  }

  if (!reasons.length) return { blocked: false, reasons: [] };

  try {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: 'compliance_hold',
        complianceStatus: 'blocked',
        complianceNotes: `[call/dial-time recheck] BLOCKED — ${reasons.join('; ')}`
      }
    });
  } catch (err) {
    console.warn(`⚠️ dial-time hold write failed for lead ${lead.id}:`, err.message);
  }
  await audit({
    actor,
    action: 'contact_blocked',
    entityType: 'Lead',
    entityId: lead.id,
    metadata: { channel: 'call', stage: 'dial_time_recheck', reasons }
  });
  return { blocked: true, reasons };
}

// ─── INBOUND SMS OPT-OUT (STOP) ──────────────────────────────────────
// Applies an inbound SMS opt-out: phone/email goes on the internal DNC
// (idempotent) and every matching lead is moved to compliance_hold so it
// can never be called or messaged again while the DNC entry stands.
async function applySmsOptOut({ phone = null, email = null, reason = 'Inbound SMS opt-out', source = 'sms_stop' }, actor = 'webhook:brevo') {
  if (!phone && !email) throw new Error('applySmsOptOut requires phone or email');
  const entry = await addToDnc({ phone, email, reason, source }, actor);
  const held = await prisma.lead.updateMany({
    where: {
      OR: [phone ? { phone } : undefined, email ? { email } : undefined].filter(Boolean),
      status: { not: 'compliance_hold' }
    },
    data: {
      status: 'compliance_hold',
      complianceStatus: 'blocked',
      complianceNotes: `SMS opt-out via ${source} — DNC`
    }
  });
  await audit({
    actor,
    action: 'sms_opt_out',
    entityType: 'DncEntry',
    entityId: entry.id,
    after: { phone, email, source },
    metadata: { leadsHeld: held.count }
  });
  return { dncEntry: entry, leadsHeld: held.count };
}

// Record a consent grant/revocation (e.g. verbal consent captured in a
// call transcript, or a web form opt-in).
async function recordConsent({ leadId = null, phone = null, channel, granted, consentType = 'express_verbal', proofText = null, source = null }, actor = 'system') {
  const event = await prisma.consentEvent.create({
    data: { leadId, phone, channel, granted, consentType, proofText, source }
  });
  await audit({ actor, action: granted ? 'consent_granted' : 'consent_revoked', entityType: 'ConsentEvent', entityId: event.id, after: { phone, channel, consentType } });
  return event;
}

module.exports = { checkContactPermission, recheckDncAtDialTime, addToDnc, applySmsOptOut, recordConsent };
