// ============================================
// SMS / EMAIL MESSAGING - BREVO ONLY
// src/lib/messaging.js
// Nexus G Partners branding (replaces Smart Choice)
// ============================================

const axios = require('axios');
const prisma = require('../db');
const { recordConsent, applySmsOptOut } = require('./compliance');
const { formatPhoneE164 } = require('./validate');

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'askdave755@gmail.com';
const CALENDLY_LINK = process.env.CALENDLY_LINK;

// ─── BREVO SMS ───
async function sendSMS(to, message) {
  if (!BREVO_API_KEY) {
    console.error('❌ BREVO_API_KEY not set');
    return null;
  }
  try {
    const formatted = to.startsWith('+') ? to : `+1${to.replace(/\D/g, '')}`;
    const response = await axios.post(
      'https://api.brevo.com/v3/transactionalSMS/sms',
      {
        sender: 'NexusG',
        recipient: formatted,
        content: message,
        type: 'transactional'
      },
      {
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Brevo SMS sent: ${response.data.reference}`);
    return response.data;
  } catch (error) {
    console.error('❌ Brevo SMS failed:', error.response?.data || error.message);
    return null;
  }
}

// ─── BREVO EMAIL ───
async function sendEmail(to, subject, html, text) {
  if (!BREVO_API_KEY) {
    console.error('❌ BREVO_API_KEY not set');
    return null;
  }
  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: 'Brady @ Nexus G Partners', email: EMAIL_FROM },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text
      },
      {
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Brevo email sent: ${response.data.messageId}`);
    return response.data;
  } catch (error) {
    console.error('❌ Brevo email failed:', error.response?.data || error.message);
    return null;
  }
}

// ─── CONSENT ARTIFACT (SPEC §6) ───
// Every outbound qualified SMS/email must have a consent artifact recorded
// BEFORE send — the express verbal consent was captured on the Vapi call.
// If the artifact cannot be recorded, the message is BLOCKED (never sent).
async function recordQualifiedConsentArtifact(lead) {
  const source = `vapi_call:${lead.vapiCallId || 'unknown'}`;
  // Idempotent: one artifact per call + channel.
  const existing = await prisma.consentEvent.findFirst({
    where: { phone: lead.phone, channel: 'sms', source }
  });
  if (existing) return existing;
  const snippet = String(lead.callSummary || lead.summary || lead.transcript || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  return recordConsent({
    leadId: lead.id || null,
    phone: lead.phone,
    channel: 'sms',
    granted: true,
    consentType: 'express_verbal',
    proofText: snippet || 'Express verbal consent captured during qualification call',
    source
  }, 'system');
}

// ─── QUALIFICATION FOLLOW-UP ───
async function sendQualificationFollowUp(lead, carrierNames) {
  const firstName = lead.name?.split(' ')[0] || 'there';
  const company = lead.company || 'your business';

  // Consent artifact FIRST — no artifact, no send.
  try {
    await recordQualifiedConsentArtifact(lead);
  } catch (err) {
    console.error(`❌ Consent artifact failed for lead ${lead.id || lead.phone} — qualified SMS/email BLOCKED:`, err.message);
    return { sent: false, blocked: true, reason: 'consent_artifact_failed', error: err.message };
  }

  // Carrier-compliant: express verbal consent captured on the call, STOP language required for US toll-free/10DLC
  const smsBody = `${firstName}, Brady here from Nexus G Partners. I found options for ${company} through ${carrierNames}. Grab a time: ${CALENDLY_LINK} Reply STOP to opt out.`;
  await sendSMS(lead.phone, smsBody);

  if (lead.email) {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#1e293b;">Hi ${firstName},</h2>
        <p>Thanks for chatting with me about ${company}'s commercial insurance.</p>
        <p>I've identified the best carriers for your risk profile: <strong>${carrierNames}</strong>.</p>
        <p>Let's lock in a 15-minute comparison:</p>
        <a href="${CALENDLY_LINK}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Book My Call</a>
        <p style="margin-top:24px;font-size:13px;color:#64748b;">Brady | Nexus G Partners</p>
      </div>
    `;
    await sendEmail(lead.email, `Insurance options ready for ${company}`, html, `Hi ${firstName}, I've identified carriers for ${company}: ${carrierNames}. Book here: ${CALENDLY_LINK}`);
  }
}

// ─── BREVO INBOUND SMS / STOP HANDLING (SPEC §6) ───
// Contract for POST /webhook/brevo/inbound payloads. Brevo inbound SMS
// shapes vary: flat { From, To, Text }, { SmsText }, or nested
// { items: [ { From, Text }, ... ] }. We normalize, detect opt-out
// keywords, and apply DNC + compliance_hold via compliance.applySmsOptOut.

const STOP_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];

// Normalize any supported Brevo inbound payload into [{ from, to, text }].
function normalizeInboundSms(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const rawItems = Array.isArray(payload.items) ? payload.items : [payload];
  return rawItems
    .filter(it => it && typeof it === 'object')
    .map(it => ({
      from: it.From || it.from || it.msisdn || it.sender || it.phoneNumber || null,
      to: it.To || it.to || it.recipient || null,
      text: it.Text || it.SmsText || it.text || it.message || it.body || ''
    }))
    .filter(m => m.from || m.text);
}

// True when the message is an opt-out keyword: exact keyword match
// (case/punctuation-insensitive) or the message STARTS with one
// (e.g. "STOP calling me").
function isStopMessage(text) {
  const words = String(text || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  if (!words.length) return false;
  if (words.length === 1 && STOP_KEYWORDS.includes(words[0])) return true;
  return STOP_KEYWORDS.includes(words[0]);
}

// Process a Brevo inbound webhook payload. STOP replies → DNC + matching
// leads to compliance_hold. Non-STOP messages are acknowledged + ignored.
async function handleBrevoInboundSms(payload, actor = 'webhook:brevo') {
  const messages = normalizeInboundSms(payload);
  const results = [];
  for (const msg of messages) {
    // Strict E.164 validation first; a STOP must never be dropped just
    // because the number format is unusual, so fall back to a normalized
    // digits form when strict parsing fails.
    let phone = msg.from ? formatPhoneE164(msg.from) : null;
    if (!phone && msg.from) {
      const digits = String(msg.from).replace(/[^\d]/g, '');
      if (digits.length >= 8 && digits.length <= 15) phone = `+${digits}`;
    }
    if (!phone) {
      results.push({ from: msg.from, stop: false, ignored: 'unparseable phone' });
      continue;
    }
    if (isStopMessage(msg.text)) {
      const { dncEntry, leadsHeld } = await applySmsOptOut({
        phone,
        reason: `Inbound SMS opt-out: "${String(msg.text).trim().slice(0, 120)}"`,
        source: 'sms_stop'
      }, actor);
      console.log(`🚫 SMS STOP from ${phone} — DNC entry ${dncEntry.id}, ${leadsHeld} lead(s) to compliance_hold`);
      results.push({ phone, stop: true, dncEntryId: dncEntry.id, leadsHeld });
    } else {
      results.push({ phone, stop: false, ignored: 'not an opt-out keyword' });
    }
  }
  return { processed: messages.length, results };
}

// ─── BACKWARD COMPATIBILITY ───
// Existing callers still import the old export names:
//   routes.js            -> sendEmailBrevo (used by GET /test-email)
//   workers/callWorker.js -> handleQualifiedLead (the qualified-lead money path)
// Keep them working on top of the Brevo functions above.

const { getTopCarriersForLead } = require('./carriers');

// Old signature: sendEmailBrevo(lead, subject, html, text)
async function sendEmailBrevo(lead, subject, html, text) {
  const result = await sendEmail(lead.email, subject, html, text);
  if (!result) throw new Error('Brevo email failed — check BREVO_API_KEY and logs');
  return result;
}

// Old signature: handleQualifiedLead(lead)
// Carrier-aware: names the top 3 matched carriers in the SMS + email.
async function handleQualifiedLead(lead) {
  let carrierNames = 'our top carriers';
  try {
    const { top3 } = getTopCarriersForLead(lead);
    if (top3) carrierNames = top3;
  } catch (err) {
    console.warn('⚠️ Carrier match failed, using generic follow-up:', err.message);
  }
  return sendQualificationFollowUp(lead, carrierNames);
}

module.exports = {
  sendSMS,
  sendEmail,
  sendQualificationFollowUp,
  recordQualifiedConsentArtifact,
  handleBrevoInboundSms,
  normalizeInboundSms,
  isStopMessage,
  STOP_KEYWORDS,
  sendEmailBrevo,      // compat: routes.js /test-email
  handleQualifiedLead  // compat: workers/callWorker.js
};
