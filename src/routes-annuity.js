/**
 * routes-annuity.js — Annuity vertical HTTP endpoints.
 *
 * COMPLIANCE-FIRST DESIGN (TCPA):
 * Purchased consumer lists (retirees) are CONSUMER contacts, not businesses.
 * AI-voice cold calls to consumer cell phones require prior express WRITTEN
 * consent — which a bought list does not provide. So annuity leads are
 * imported with autoCall DEFAULT OFF and routed to an EMAIL/SMS nurture
 * sequence (annuity_drip_v1). Vapi only enters the picture AFTER a lead
 * engages and grants consent (recorded via /api/consent), at which point
 * the compliance engine's SMS/consent checks already handle the gate.
 *
 * Wire-up in server.js (follows attachLifeRoutes pattern):
 *   const { attachAnnuityRoutes } = require('./routes-annuity');
 *   attachAnnuityRoutes(app, pool);
 */
const { z } = require('zod');
const prisma = require('./db');
const { callQueue } = require('./queue');
const { formatPhoneE164 } = require('./lib/validate');
const { requireAdminKey } = require('./lib/auth');
const { enroll } = require('./lib/sequences');
const config = require('./config');

// Estimated-assets bracket → midpoint proxy for scoring/sorting.
const ASSET_MIDPOINTS = {
  'under_50k': 25000,
  '50k_100k': 75000,
  '100k_250k': 175000,
  '250k_500k': 375000,
  '500k_1m': 750000,
  '1m_plus': 1500000
};

// Simple annuity-fit score (0–100): age proximity to retirement, assets,
// homeownership, rollover intent. Pure sort aid — not a qualification gate.
function annuityScore(l) {
  let s = 0;
  const age = l.age;
  if (age !== null && age !== undefined) {
    if (age >= 55 && age <= 75) s += 30;      // sweet spot
    else if (age >= 45 && age < 55) s += 18;  // accumulation phase
    else if (age > 75) s += 12;               // income phase, fewer products fit
  }
  const assets = ASSET_MIDPOINTS[l.assetBracket] || (l.estimatedAssets || 0);
  if (assets >= 250000) s += 30;
  else if (assets >= 100000) s += 22;
  else if (assets >= 50000) s += 12;
  if (l.homeowner === true) s += 15;
  if (l.rolloverIntent === true) s += 25;
  return Math.min(s, 100);
}

function attachAnnuityRoutes(app, pool) {

  // ── Import consumer annuity list (Data Axle / LeadsPlease CSV) ──
  // POST /api/annuity/import  [admin key]
  //   { csv: "name,phone,email,age,state,city,assets,homeowner,rollover" }
  // or { leads: [ {...} ] }
  //
  // Column mapping is forgiving — matches common broker export headers.
  // There is NO autoCall on this path: consumer lists route to the email/SMS
  // drip only; Vapi requires consent (see header comment).
  app.post('/api/annuity/import', requireAdminKey, async (req, res) => {
    let rows = req.body.leads;
    if (!rows && req.body.csv) {
      const lines = String(req.body.csv).split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return res.status(400).json({ error: 'csv needs a header row + data' });
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '_'));
      rows = lines.slice(1).map(l => {
        const cols = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)
          .map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
        const o = {};
        headers.forEach((h, i) => { o[h] = cols[i] || ''; });
        return o;
      });
    }
    if (!rows || !rows.length) return res.status(400).json({ error: 'leads array or csv string required' });

    const pick = (o, ...keys) => { for (const k of keys) { if (o[k] !== undefined && o[k] !== null && String(o[k]).trim() !== '') return String(o[k]).trim(); } return ''; };
    const toBool = v => ['true', 'yes', 'y', '1'].includes(String(v).toLowerCase()) ? true
                      : ['false', 'no', 'n', '0'].includes(String(v).toLowerCase()) ? false : null;

    const results = { imported: 0, skipped: 0, dncBlocked: 0, enrolled: 0, errors: 0, ids: [] };

    for (const row of rows.slice(0, 2000)) {
      try {
        const first = pick(row, 'first_name', 'first', 'firstname');
        const last = pick(row, 'last_name', 'last', 'lastname');
        const name = pick(row, 'name', 'full_name', 'contact_name') || (first + ' ' + last).trim();
        const phone = formatPhoneE164(pick(row, 'phone', 'phone_1', 'phone_number', 'telephone', 'home_phone', 'mobile_phone'));
        const email = pick(row, 'email', 'email_1', 'personal_email', 'e_mail') || null;
        const age = parseInt(pick(row, 'age', 'exact_age', 'age_range_mid'), 10) || null;
        const state = pick(row, 'state', 'st', 'person_state').toUpperCase().slice(0, 2);
        const city = pick(row, 'city', 'person_city') || null;
        const assetBracket = pick(row, 'asset_bracket', 'net_worth', 'assets', 'investable_assets') || null;

        if (!name || name.length < 2 || !phone || !state) { results.skipped++; continue; }
        if (!config.ALLOWED_STATES.includes(state)) { results.skipped++; continue; }

        const existing = await prisma.lead.findFirst({ where: { phone, status: { notIn: ['closed', 'compliance_hold'] } } });
        if (existing) { results.skipped++; continue; }

        // Hard stop: phone/email already on internal DNC — do not even import.
        const dnc = await prisma.dncEntry.findFirst({
          where: { OR: [{ phone }, ...(email ? [{ email }] : [])] }
        });
        if (dnc) { results.dncBlocked++; continue; }

        const lead = await prisma.lead.create({
          data: {
            name, phone, email, state, city,
            age,
            insuranceType: 'annuity',
            vertical: 'annuity',
            source: req.body.source ? String(req.body.source).slice(0, 40) : 'consumer_list',
            status: 'pending',
            // Asset bracket rides in industry (unused for annuity) so it is
            // queryable without a schema change; age is a native column.
            industry: assetBracket,
            complianceStatus: 'unchecked',
            complianceNotes: 'Consumer list import — email/SMS nurture only; no Vapi until consent'
          }
        });

        results.imported++;
        results.ids.push(lead.id);

        // Enroll in the nurture drip (email-first). The sequence engine
        // re-checks DNC before every step and respects quiet hours.
        try {
          await enroll(lead, 'annuity_drip_v1', { owner_age: age || '', vertical_branch: 'annuity' });
          results.enrolled++;
        } catch (e) {
          console.warn('annuity enroll failed for lead ' + lead.id + ': ' + e.message);
        }
      } catch (e) {
        results.errors++;
      }
    }

    console.log(`📈 Annuity import: ${results.imported} imported, ${results.enrolled} enrolled, ${results.skipped} skipped, ${results.dncBlocked} DNC-blocked, ${results.errors} errors`);
    res.json({ success: true, vertical: 'annuity', ...results, ids: results.ids.slice(0, 20) });
  });

  // ── Single annuity lead (manual / referral) — consent-aware ──
  // POST /api/annuity/leads { name, phone, email?, age?, state, city?, consent?: bool }
  // consent=true means prior express consent exists (web form, referral, inbound).
  // Only then is Vapi queued. Otherwise → nurture sequence.
  app.post('/api/annuity/leads', requireAdminKey, async (req, res) => {
    const schema = z.object({
      name: z.string().min(2),
      phone: z.string(),
      email: z.string().email().optional(),
      age: z.number().min(18).max(100).optional(),
      state: z.string().length(2).toUpperCase(),
      city: z.string().optional(),
      consent: z.boolean().default(false)
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const d = parsed.data;

    if (!config.ALLOWED_STATES.includes(d.state)) {
      return res.status(400).json({ error: 'State ' + d.state + ' not licensed/allowed', allowed: config.ALLOWED_STATES });
    }
    const phone = formatPhoneE164(d.phone);
    if (!phone) return res.status(400).json({ error: 'Invalid phone number' });

    const existing = await prisma.lead.findFirst({ where: { phone, status: { notIn: ['closed', 'compliance_hold'] } } });
    if (existing) return res.json({ success: false, reason: 'duplicate', leadId: existing.id });

    const lead = await prisma.lead.create({
      data: {
        name: d.name, phone, email: d.email, age: d.age, state: d.state, city: d.city,
        insuranceType: 'annuity', vertical: 'annuity',
        source: 'annuity_manual', status: 'pending',
        complianceNotes: d.consent ? 'Consent asserted at import' : 'No consent — nurture only'
      }
    });

    if (d.consent) {
      await callQueue.add('make-call', { leadId: lead.id }, { delay: 5000, priority: 5 });
      console.log('📈 Annuity lead WITH consent: ' + lead.name + ' queued for Vapi');
      return res.json({ success: true, leadId: lead.id, path: 'vapi_call' });
    }

    await enroll(lead, 'annuity_drip_v1', { owner_age: d.age || '', vertical_branch: 'annuity' });
    console.log('📈 Annuity lead (no consent): ' + lead.name + ' -> nurture sequence');
    res.json({ success: true, leadId: lead.id, path: 'nurture_sequence' });
  });

  // ── Annuity funnel stats ──
  // GET /api/annuity/stats [admin key]
  app.get('/api/annuity/stats', requireAdminKey, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT status, COUNT(*)::int AS total, AVG(age)::int AS avg_age
         FROM leads WHERE vertical='annuity' GROUP BY status ORDER BY total DESC`, []);
      const scoreRows = await prisma.lead.findMany({
        where: { vertical: 'annuity' },
        select: { id: true, name: true, phone: true, state: true, age: true, industry: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200
      });
      res.json({
        byStatus: r.rows,
        topProspects: scoreRows
          .map(l => ({ ...l, assetBracket: l.industry, score: annuityScore({ age: l.age, assetBracket: l.industry }) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 50)
      });
    } catch (e) {
      console.error('annuity/stats failed:', e.message);
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { attachAnnuityRoutes };
