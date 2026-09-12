/**
 * routes-life.js - Life vertical HTTP endpoints.
 * Wire-up in server.js (follows attachCarrierRoutes pattern):
 *   const { attachLifeRoutes } = require('./routes-life');
 *   attachLifeRoutes(app, pool);   // pool = the pg-style Prisma shim
 */
const { z } = require('zod');
const prisma = require('./db');
const { callQueue } = require('./queue');
const { CITY_COORDS, hasdataMapsSearch, importHasDataRows } = require('./lib/hasdata');
const { formatPhoneE164 } = require('./lib/validate');
const { quotesEmailHtml } = require('./lib/lifePipeline');
const { brevoEmail, brevoSMS } = require('./lib/brevo');
const { requireAdminKey } = require('./lib/auth');
const { detectOccupation } = require('./lib/occupations');
const config = require('./config');

// Russell completeness score (reference weights): age 25, tobacco 20,
// coverage 25, meds 10, premium 10, email 20 (max 100).
function factFindScore(l) {
  let s = 0;
  if (l.age) s += 25;
  if (l.smoker !== null && l.smoker !== undefined) s += 20;
  if (l.coverageAmount) s += 25;
  if (l.medications) s += 10;
  if (l.monthlyPremium) s += 10;
  if (l.email) s += 20;
  return Math.min(s, 100);
}

// ─── gosom google-maps-scraper CSV helpers ───
// gosom rows carry a full address string, no separate city/state columns.
// Handles "123 Main St, Detroit, MI 48201", "Detroit, MI 48201", "Detroit, MI".
function parseGmapsAddress(address) {
  const a = String(address || '');
  let m = a.match(/,\s*([^,]+),\s*([A-Z]{2})\s+\d{5}/i);          // street, city, ST zip
  if (m) return { city: m[1].trim(), state: m[2].toUpperCase() };
  m = a.match(/^\s*([^,]+),\s*([A-Z]{2})(?:\s+\d{5})?\s*$/i);     // city, ST [zip]
  if (m) return { city: m[1].trim(), state: m[2].toUpperCase() };
  m = a.match(/,\s*([A-Z]{2})\s+\d{5}/i);                          // street, ST zip (no city)
  if (m) return { city: null, state: m[1].toUpperCase() };
  return { city: null, state: null };
}

// gosom -email output may hold several addresses in one cell.
function firstEmail(raw) {
  const m = String(raw || '').match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
  return m ? m[0] : '';
}

// Redis/Bull calls with a deadline — never hang the HTTP request.
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('redis timeout')), ms))]);
}

function attachLifeRoutes(app, pool) {
  // Manual scrape trigger (Phase 1): POST /api/scraper/hasdata/run
  // Body: { "query": "barbershops", "city": "Detroit, MI", "start": 0 }
  app.post('/api/scraper/hasdata/run', requireAdminKey, async (req, res) => {
    const { query, city, start } = req.body;
    if (!query || !city) return res.status(400).json({ error: 'query and city required' });
    const ll = CITY_COORDS[city.toLowerCase().trim()];
    if (!ll) return res.status(400).json({ error: 'city not in CITY_COORDS - add coordinates to lib/hasdata.js first' });
    try {
      const data = await hasdataMapsSearch(query, ll, start);
      const stats = await importHasDataRows(data, pool, query);
      console.log('HasData ' + query + ' / ' + city + ': ' + stats.imported + ' imported, ' + stats.skipped + ' skipped');
      res.json({ city, query, ...stats });
    } catch (e) {
      console.error('HasData search failed:', e.response?.status, e.response?.data || e.message);
      res.status(502).json({ error: 'HasData request failed', detail: e.response?.status });
    }
  });

  // Optional: no-code scraper product webhook (not needed for direct API, kept for later)
  app.post('/api/scraper/hasdata', requireAdminKey, async (req, res) => {
    const rows = req.body?.results || (Array.isArray(req.body) ? req.body : [req.body]);
    const stats = await importHasDataRows(rows, pool, req.body?.query || null);
    console.log('HasData webhook: ' + stats.imported + ' imported, ' + stats.skipped + ' skipped');
    res.json(stats);
  });

  // Dashboard helper: per-niche conversion stats.
  // NOTE: try/catch + explicit [] params — the pg-style Prisma shim throws on
  // undefined params, and an uncaught async throw hangs the request (502).
  // Counts cast ::int — pg returns COUNT/SUM as BigInt, which res.json can't serialize.
  app.get('/api/life/stats', requireAdminKey, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT occupation,
                COUNT(*)::int AS total,
                SUM(CASE WHEN status='called' THEN 1 ELSE 0 END)::int AS called,
                SUM(CASE WHEN qualified THEN 1 ELSE 0 END)::int AS qualified,
                SUM(CASE WHEN quote_email_sent THEN 1 ELSE 0 END)::int AS emailed
         FROM leads WHERE vertical='life_fe' GROUP BY occupation ORDER BY total DESC`,
        []);
      res.json(r.rows);
    } catch (e) {
      console.error('life/stats failed:', e.message);
      res.status(500).json({ error: 'stats query failed', detail: e.message });
    }
  });

  // ── CALL ENGINE START / STOP (backs public/calls.html) ──
  // Stop = Bull global pause (stored in Redis — survives Railway redeploys).
  // Start = sweep pending life leads into the queue (90s spacing) + resume.
  // Job IDs are 'life-<leadId>' so repeat taps can't double-queue a lead.
  // The worker enforces business hours per lead state — after-hours leads
  // self-reschedule to the next calling window.

  app.get('/api/life/calls/status', requireAdminKey, async (req, res) => {
    let paused = null, counts = null;
    try { paused = await withTimeout(callQueue.isPaused(), 5000); } catch (e) { /* redis slow */ }
    try { counts = await withTimeout(callQueue.getJobCounts(), 5000); } catch (e) { counts = { unavailable: true }; }
    try {
      const pendingLife = await prisma.lead.count({ where: { vertical: 'life_fe', status: 'pending' } });
      res.json({ paused, counts, pendingLife });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/life/calls/start?limit=20          — queue + resume
  // GET /api/life/calls/start?limit=20&dry=1    — preview only, queues nothing
  app.get('/api/life/calls/start', requireAdminKey, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const dry = req.query.dry === '1' || req.query.dry === 'true';
      const leads = await prisma.lead.findMany({
        where: { vertical: 'life_fe', status: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { id: true, name: true, phone: true, state: true, city: true, occupation: true, createdAt: true }
      });
      if (dry) return res.json({ dry: true, wouldQueue: leads.length, leads });

      for (let i = 0; i < leads.length; i++) {
        await callQueue.add('make-call', { leadId: leads[i].id },
          { delay: 5000 + i * 90000, priority: 5, jobId: 'life-' + leads[i].id });
      }
      await callQueue.resume();
      console.log('▶️ Life calls START: ' + leads.length + ' queued (90s spacing), queue resumed');
      res.json({
        queued: leads.length,
        spacingSeconds: 90,
        queue: 'resumed',
        note: 'Worker enforces business hours per lead state — after-hours leads self-reschedule.'
      });
    } catch (e) {
      console.error('life calls/start failed:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/life/calls/stop', requireAdminKey, async (req, res) => {
    try {
      await callQueue.pause();
      console.log('⏹️ Life calls STOP: queue paused');
      res.json({ status: 'paused', message: 'Queue paused — calls in progress finish, nothing new dials.' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Additional life endpoints ──

  // Manual life lead entry: POST /api/life/leads
  // { name, phone, email?, company?, occupation?, state, city?, autoCall? }
  app.post('/api/life/leads', async (req, res) => {
    const schema = z.object({
      name: z.string().min(2),
      phone: z.string(),
      email: z.string().email().optional(),
      company: z.string().optional(),
      occupation: z.string().optional(),
      state: z.string().length(2).toUpperCase(),
      city: z.string().optional(),
      autoCall: z.boolean().default(true)
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const data = parsed.data;

    if (!config.ALLOWED_STATES.includes(data.state)) {
      return res.status(400).json({ error: `State ${data.state} not licensed/allowed`, allowed: config.ALLOWED_STATES });
    }

    const phone = formatPhoneE164(data.phone);
    if (!phone) return res.status(400).json({ error: 'Invalid phone number' });

    const existing = await prisma.lead.findFirst({
      where: { phone, status: { notIn: ['closed', 'compliance_hold'] } }
    });
    if (existing) return res.json({ success: false, reason: 'duplicate', leadId: existing.id });

    const lead = await prisma.lead.create({
      data: {
        name: data.name,
        phone,
        email: data.email,
        company: data.company,
        industry: data.occupation,
        occupation: data.occupation,
        state: data.state,
        city: data.city,
        insuranceType: 'life',
        vertical: 'life_fe',
        source: 'life_manual',
        status: 'pending'
      }
    });

    if (data.autoCall) {
      await callQueue.add('make-call', { leadId: lead.id }, { delay: 5000, priority: 5 });
    }
    console.log(`💚 Life lead created: ${lead.name} (${data.occupation || 'unknown occ'}, ${lead.state})`);
    res.json({ success: true, leadId: lead.id, queued: data.autoCall });
  });

  // Browser-friendly life test call: GET /api/life/test-call/:phone?force=true
  // Test lead uses occupation 'barber' (person noun) — matches what
  // lib/occupations.js produces for real HasData imports, so the
  // opener "You still a {{occupation}}?" reads correctly on test calls.
  app.get('/api/life/test-call/:phone', requireAdminKey, async (req, res) => {
    try {
      const phone = formatPhoneE164(req.params.phone);
      if (!phone) return res.status(400).json({ error: 'Invalid phone number' });
      const force = req.query.force === 'true';

      const lead = await prisma.lead.create({
        data: {
          name: 'Dave Test',
          phone,
          email: 'askdave755@gmail.com',
          company: 'Test Barbershop',
          industry: 'barbershop',
          occupation: 'barber',
          state: 'MI',
          insuranceType: 'life',
          vertical: 'life_fe',
          source: 'life_manual_test',
          status: 'pending'
        }
      });

      await callQueue.add('make-call', force ? { leadId: lead.id, force: true } : { leadId: lead.id }, { delay: 3000 });
      res.json({ message: `Life test call queued for ${phone} (3s)${force ? ' [FORCE]' : ''}`, leadId: lead.id, force });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Fact-find list — reads the fact-find columns on leads directly.
  // GET /api/life/factfinds?minScore=50&limit=50
  app.get('/api/life/factfinds', requireAdminKey, async (req, res) => {
    const { minScore = 50, limit = 50 } = req.query;
    const leads = await prisma.lead.findMany({
      where: { vertical: 'life_fe', age: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: parseInt(limit),
      select: {
        id: true, name: true, phone: true, email: true, company: true,
        state: true, city: true, occupation: true, status: true, qualified: true,
        age: true, smoker: true, medications: true,
        monthlyPremium: true, coverageAmount: true, quoteEmailSent: true,
        updatedAt: true
      }
    });
    const scored = leads
      .map(l => ({ ...l, score: factFindScore(l) }))
      .filter(l => l.score >= parseInt(minScore));
    res.json(scored);
  });

  // Manual fact-find entry/edit: POST /api/life/factfind/:leadId
  // { age?, smoker?, medications?, coverageAmount?, monthlyPremium?, email? }
  app.post('/api/life/factfind/:leadId', requireAdminKey, async (req, res) => {
    const schema = z.object({
      age: z.number().min(18).max(85).optional(),
      smoker: z.boolean().optional(),
      medications: z.string().optional(),
      coverageAmount: z.number().optional(),
      monthlyPremium: z.number().optional(),
      email: z.string().email().optional()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });

    const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updated = await prisma.lead.update({ where: { id: lead.id }, data: parsed.data });
    res.json({ success: true, lead: updated, score: factFindScore(updated) });
  });

  // Re-send InsureMeNow Direct quote link: POST /api/life/factfind/:leadId/resend
  app.post('/api/life/factfind/:leadId/resend', requireAdminKey, async (req, res) => {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const ff = {
      age: lead.age,
      smoker: lead.smoker,
      medications: lead.medications,
      monthly_premium: lead.monthlyPremium,
      coverage_amount: lead.coverageAmount,
      email: lead.email
    };

    if (lead.email) {
      const IMN_URL = process.env.IMN_URL || 'https://insuremenowdirect.com/agent/dawudrafael/';
      const first = (lead.name || 'there').split(' ')[0];
      await brevoEmail(lead.email,
        first + ', your life insurance quotes are ready',
        quotesEmailHtml(lead, ff));
      await brevoSMS(lead.phone,
        first + ', Brady here (David Hughes Insurance) - your quotes are in your inbox (' + lead.email +
        '). Or see rates in 90 seconds here: ' + IMN_URL + '?src=brady-sms&ref=' + lead.id +
        ' Reply STOP to opt out');
      await prisma.lead.update({ where: { id: lead.id }, data: { quoteEmailSent: true } });
      res.json({ success: true, channel: 'email+sms', sentTo: lead.email, smsTo: lead.phone });
    } else {
      await brevoSMS(lead.phone,
        'Brady here (David Hughes Insurance) - what is the best email for your quotes? Reply STOP to opt out');
      res.json({ success: true, channel: 'sms', sentTo: lead.phone });
    }
  });

  // Brevo SMS diagnostics: GET /api/life/test-sms?to=+1XXXXXXXXXX
  app.get('/api/life/test-sms', requireAdminKey, async (req, res) => {
    const axios = require('axios');
    const key = process.env.BREVO_API_KEY;
    const out = { sender: process.env.BREVO_SMS_SENDER || 'Brady' };
    try {
      const r = await axios.get('https://api.brevo.com/v3/transactionalSMS/sms?limit=5', { headers: { 'api-key': key } });
      out.recent = r.data;
    } catch (e) { out.listError = (e.response && e.response.data) || e.message; }
    const to = req.query.to;
    if (to) {
      try {
        const r = await axios.post('https://api.brevo.com/v3/transactionalSMS/sms', {
          sender: out.sender,
          recipient: to,
          content: 'Test from David Hughes Insurance - your quotes link works. Reply STOP to opt out',
          type: 'transactional'
        }, { headers: { 'api-key': key, 'Content-Type': 'application/json' } });
        out.sent = r.data;
      } catch (e) { out.sendError = (e.response && e.response.data) || e.message; }
    }
    res.json(out);
  });

  // ── Bulk lead import (gosom local scraper, Apollo CSV for life, FMCSA CSV for commercial) ──
  // POST /api/import/leads
  //   { vertical: "life_fe"|"commercial_auto", autoCall?: false,
  //     source?: "gmaps_local",            // free-form ROI tag; default keeps legacy values
  //     leads?: [...], csv?: "name,phone,..." }
  //
  // gosom google-maps-scraper CSV works as-is:
  //   title           -> name + company
  //   phone           -> phone
  //   complete_address/address -> city + state parsed out
  //   category        -> industry + occupation (via lib/occupations.js)
  //   emails          -> first valid email
  // Example: curl -X POST .../api/import/leads?key=ADMIN \
  //   -H 'Content-Type: application/json' \
  //   -d '{"vertical":"life_fe","source":"gmaps_local","csv":"'"$(cat results.csv)"'"}'
  app.post('/api/import/leads', requireAdminKey, async (req, res) => {
    const vertical = req.body.vertical;
    if (!['life_fe', 'commercial_auto'].includes(vertical)) {
      return res.status(400).json({ error: 'vertical must be life_fe or commercial_auto' });
    }

    // Accept JSON rows or raw CSV text (header row required)
    let rows = req.body.leads;
    if (!rows && req.body.csv) {
      const lines = String(req.body.csv).split(/\r?\n/).filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '_'));
      rows = lines.slice(1).map(l => {
        const cols = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
        const o = {};
        headers.forEach((h, i) => { o[h] = cols[i] || ''; });
        return o;
      });
    }
    if (!rows || !rows.length) return res.status(400).json({ error: 'leads array or csv string required' });

    // ROI tracking: caller may tag the scraper/source explicitly
    // (e.g. "gmaps_local"); otherwise keep the legacy per-vertical tags.
    const sourceTag = req.body.source ? String(req.body.source).slice(0, 40) : null;

    // Flexible column mapping (gosom + Apollo + FMCSA export names)
    const pick = (o, ...keys) => { for (const k of keys) { if (o[k]) return String(o[k]).trim(); } return ''; };
    const results = { imported: 0, skipped: 0, errors: 0, queued: 0, ids: [] };

    for (const row of rows.slice(0, 2000)) {
      try {
        const first = pick(row, 'first_name', 'first', 'firstname');
        const last = pick(row, 'last_name', 'last', 'lastname');
        const name = pick(row, 'name', 'full_name', 'contact_name', 'legal_name', 'dba_name', 'title') || (first + ' ' + last).trim();
        const phoneRaw = pick(row, 'phone', 'mobile_phone', 'work_direct_phone', 'phone_number', 'telephone', 'phone_1');

        // State/city: explicit columns win; otherwise parse the gosom address
        let state = pick(row, 'state', 'person_state', 'company_state', 'phy_state', 'st').toUpperCase().slice(0, 2);
        let city = pick(row, 'city', 'person_city', 'company_city', 'phy_city') || null;
        if (!state) {
          const parsed = parseGmapsAddress(pick(row, 'complete_address', 'address', 'full_address', 'location'));
          if (parsed.state) state = parsed.state;
          if (!city && parsed.city) city = parsed.city;
        }

        const phone = formatPhoneE164(phoneRaw);
        if (!name || name.length < 2 || !phone || !state) { results.skipped++; continue; }
        if (!config.ALLOWED_STATES.includes(state)) { results.skipped++; continue; }

        const existing = await prisma.lead.findFirst({ where: { phone, status: { notIn: ['closed', 'compliance_hold'] } } });
        if (existing) { results.skipped++; continue; }

        const isLife = vertical === 'life_fe';
        const category = pick(row, 'category', 'categories');
        const occ = category ? detectOccupation(category, pick(row, 'descriptions', 'description')) : null;
        const lead = await prisma.lead.create({
          data: {
            name,
            phone,
            email: pick(row, 'email', 'email_1', 'work_email', 'personal_email') || firstEmail(row.emails) || null,
            company: pick(row, 'company', 'company_name', 'organization_name', 'legal_name', 'dba_name', 'title') || null,
            title: pick(row, 'title', 'job_title') || null,
            industry: pick(row, 'industry', 'occupation', 'operation_classification', 'cargo_carried') || category || null,
            occupation: isLife ? (pick(row, 'occupation') || (occ && occ.singular !== 'business owner' ? occ.singular : null) || null) : null,
            occupationPlural: isLife && occ && occ.singular !== 'business owner' ? occ.plural : null,
            state,
            city,
            insuranceType: isLife ? 'life' : 'commercial_auto',
            vertical,
            source: sourceTag || (isLife ? 'apollo_import' : 'fmcsa_import'),
            status: 'pending'
          }
        });
        results.imported++;
        results.ids.push(lead.id);

        if (req.body.autoCall === true) {
          await callQueue.add('make-call', { leadId: lead.id }, { delay: 5000 + results.queued * 90000, priority: 5 });
          results.queued++;
        }
      } catch (e) { results.errors++; }
    }

    console.log('Import ' + vertical + ' [' + (sourceTag || 'default') + ']: ' + results.imported + ' imported, ' + results.skipped + ' skipped, ' + results.queued + ' queued');
    res.json({ success: true, vertical, source: sourceTag || undefined, ...results, ids: results.ids.slice(0, 20) });
  });
}

module.exports = { attachLifeRoutes };
