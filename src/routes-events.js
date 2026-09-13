/**
 * routes-events.js — HTTP surface for the InsureFlow event spec.
 *
 * Wire-up in server.js:
 *   const { attachEventRoutes } = require('./routes-events');
 *   attachEventRoutes(app, pool);
 *   require('./lib/sequences');   // registers the sequence-step worker
 *
 * All /api/events/* routes need the admin key. The Brevo inbound webhook
 * takes the key as ?key= in the webhook URL (Brevo can't set headers).
 */

const prisma = require('./db');
const { requireAdminKey } = require('./lib/auth');
const { formatPhoneE164 } = require('./lib/validate');
const events = require('./lib/events');
const seq = require('./lib/sequences');

// Find a lead by leadId, or by phone (most recent non-closed match).
async function findLead(body, params = {}) {
  const id = body.leadId || params.leadId;
  if (id) return prisma.lead.findUnique({ where: { id } });
  const phone = formatPhoneE164(body.phone || '');
  if (!phone) return null;
  return prisma.lead.findFirst({
    where: { phone, status: { notIn: ['closed'] } },
    orderBy: { createdAt: 'desc' }
  });
}

function attachEventRoutes(app, pool) {

  // ── quote.created / quote.issued ──
  // POST /api/events/quote
  // { leadId|phone, type: 'created'|'issued', premium?, carrier?, discovery?,
  //   sms_optin?, premium_range?, coverage_summary?, business_class?,
  //   moved_direction?, expiry_date?, vertical_branch?, force? }
  app.post('/api/events/quote', requireAdminKey, async (req, res) => {
    try {
      const lead = await findLead(req.body);
      if (!lead) return res.status(404).json({ error: 'Lead not found (pass leadId or phone)' });
      const type = req.body.type || 'issued';
      const out = type === 'created'
        ? { type, ...(await events.quoteCreated(lead, req.body)) }
        : { type: 'issued', ...(await events.quoteIssued(lead, req.body)) };
      res.json({ success: true, leadId: lead.id, ...out });
    } catch (e) {
      console.error('events/quote failed:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── appointment.booked ──
  // POST /api/events/appointment { leadId|phone, time (ISO), notes? }
  app.post('/api/events/appointment', requireAdminKey, async (req, res) => {
    try {
      const lead = await findLead(req.body);
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      res.json({ success: true, leadId: lead.id, ...(await events.appointmentBooked(lead, req.body)) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── policy.bound (manual mark; carrier webhooks can POST here too) ──
  // POST /api/events/bound/:leadId
  // { bind_date?, carrier?, premium?, commission_rate?, policy_number?,
  //   occ_acc_price?, owner_age?, force? }
  app.post('/api/events/bound/:leadId', requireAdminKey, async (req, res) => {
    try {
      const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId } });
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      res.json({ success: true, leadId: lead.id, ...(await events.policyBound(lead, req.body)) });
    } catch (e) {
      console.error('events/bound failed:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ── crosssell.consented ──
  // POST /api/events/crosssell { leadId|phone, product, notes? }
  app.post('/api/events/crosssell', requireAdminKey, async (req, res) => {
    try {
      const lead = await findLead(req.body);
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      res.json({ success: true, leadId: lead.id, ...(await events.crosssellConsented(lead, req.body)) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── call.dnc ──
  // POST /api/events/dnc { leadId|phone, reason?, source? }
  app.post('/api/events/dnc', requireAdminKey, async (req, res) => {
    try {
      const lead = await findLead(req.body);
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
      res.json({ success: true, leadId: lead.id, ...(await events.callDnc(lead, req.body)) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── sequence enrollment viewer (dashboard support) ──
  // GET /api/events/sequences?leadId=optional
  app.get('/api/events/sequences', requireAdminKey, async (req, res) => {
    try {
      res.json(await seq.getEnrollments(req.query.leadId || null));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Manual stop (agent kills automation for a lead from the dashboard)
  // POST /api/events/sequences/stop { leadId, sequence?, reason? }
  app.post('/api/events/sequences/stop', requireAdminKey, async (req, res) => {
    try {
      const stopped = await seq.stopEnrollment(
        req.body.leadId, req.body.reason || 'manual_stop', req.body.sequence || null);
      res.json({ success: true, stopped });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Brevo inbound webhook (quote.followup_reply) ──
  // Point Brevo SMS inbound + inbound-parse email at:
  //   POST /webhook/brevo/inbound?key=ADMIN_KEY
  // Accepts Brevo SMS shape { from, text } and generic { from|sender|email,
  // phone, text|body|subject }.
  app.post('/webhook/brevo/inbound', requireAdminKey, async (req, res) => {
    try {
      const b = req.body || {};
      const rawFrom = b.from || b.sender || b.phone || b.msisdn || '';
      const email = (b.email || (typeof b.sender === 'string' && b.sender.includes('@') ? b.sender : '') || '').toLowerCase();
      const text = b.text || b.body || b.subject || b.message || '';

      const phone = formatPhoneE164(rawFrom);
      let lead = null;
      if (phone) {
        lead = await prisma.lead.findFirst({
          where: { phone, status: { notIn: ['closed'] } },
          orderBy: { createdAt: 'desc' }
        });
      }
      if (!lead && email) {
        lead = await prisma.lead.findFirst({
          where: { email, status: { notIn: ['closed'] } },
          orderBy: { createdAt: 'desc' }
        });
      }
      if (!lead) {
        console.log('📥 Inbound from unknown contact:', rawFrom || email);
        return res.json({ received: true, matched: false });
      }
      const out = await events.followupReply(lead, { text, channel: phone ? 'sms' : 'email' });
      res.json({ received: true, matched: true, leadId: lead.id, ...out });
    } catch (e) {
      console.error('brevo inbound failed:', e.message);
      res.status(200).json({ received: true, error: e.message });
    }
  });
}

module.exports = { attachEventRoutes };
