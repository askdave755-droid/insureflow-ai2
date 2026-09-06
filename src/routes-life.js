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
const { sendLifeFollowUp, factFindScore } = require('./lib/life');
const { requireAdminKey } = require('./lib/auth');
const config = require('./config');

function attachLifeRoutes(app, pool) {
  // Manual scrape trigger (Phase 1): POST /api/scraper/hasdata/run
  // Body: { "query": "barbershops", "city": "Detroit, MI", "start": 0 }
  app.post('/api/scraper/hasdata/run', async (req, res) => {
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
  app.post('/api/scraper/hasdata', async (req, res) => {
    const rows = req.body?.results || (Array.isArray(req.body) ? req.body : [req.body]);
    const stats = await importHasDataRows(rows, pool, req.body?.query || null);
    console.log('HasData webhook: ' + stats.imported + ' imported, ' + stats.skipped + ' skipped');
    res.json(stats);
  });

  // Dashboard helper: per-niche conversion stats
  app.get('/api/life/stats', async (req, res) => {
    const r = await pool.query(
      `SELECT occupation, COUNT(*) AS total,
              SUM(CASE WHEN status='called' THEN 1 ELSE 0 END) AS called,
              SUM(CASE WHEN qualified THEN 1 ELSE 0 END) AS qualified,
              SUM(CASE WHEN quote_email_sent THEN 1 ELSE 0 END) AS emailed
       FROM leads WHERE vertical='life_fe' GROUP BY occupation ORDER BY total DESC`);
    res.json(r.rows);
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
          occupation: 'barbershop',
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
      .map(l => ({
        ...l,
        score: factFindScore({
          age: l.age,
          tobacco: l.smoker,
          coverageGoal: l.coverageAmount,
          monthlyBudget: l.monthlyPremium,
          healthFlags: l.medications ? l.medications.split(',') : undefined
        })
      }))
      .filter(l => l.score >= parseInt(minScore));
    res.json(scored);
  });

  // Manual fact-find entry/edit: POST /api/life/factfind/:leadId
  // { age?, smoker?, medications?, coverageAmount?, monthlyPremium? }
  app.post('/api/life/factfind/:leadId', requireAdminKey, async (req, res) => {
    const schema = z.object({
      age: z.number().min(18).max(85).optional(),
      smoker: z.boolean().optional(),
      medications: z.string().optional(),
      coverageAmount: z.number().optional(),
      monthlyPremium: z.number().optional()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });

    const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updated = await prisma.lead.update({ where: { id: lead.id }, data: parsed.data });
    res.json({
      success: true,
      lead: updated,
      score: factFindScore({
        age: updated.age, tobacco: updated.smoker,
        coverageGoal: updated.coverageAmount, monthlyBudget: updated.monthlyPremium
      })
    });
  });

  // Re-send InsureMeNow quote link: POST /api/life/factfind/:leadId/resend
  app.post('/api/life/factfind/:leadId/resend', requireAdminKey, async (req, res) => {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    await sendLifeFollowUp(lead, {
      age: lead.age,
      tobacco: lead.smoker,
      coverageGoal: lead.coverageAmount,
      monthlyBudget: lead.monthlyPremium,
      email: lead.email
    });
    res.json({ success: true, sentTo: { phone: lead.phone, email: lead.email } });
  });
}

module.exports = { attachLifeRoutes };
