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

// Owner notifications inbox — env-overridable via OWNER_EMAIL.
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'nexusgpartners@gmail.com';

// ── helpers ──
function ok(res, data) { res.json({ ok: true, ...data }); }
function bad(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }

async function importQuery(pool, { niche, city, pages = 1 }) {
  const ll = CITY_COORDS[city.toLowerCase()];
  if (!ll) throw new Error(`No coordinates for city: ${city} (have: ${Object.keys(CITY_COORDS).join(', ')})`);
  let total = { imported: 0, skipped: 0 };
  for (let p = 0; p < pages; p++) {
    const rows = await hasdataMapsSearch(niche, ll, p * 20);
    const r = await importHasDataRows(rows, pool, niche);
    total.imported += r.imported; total.skipped += r.skipped;
  }
  return total;
}

// ── routes ──
function attachLifeRoutes(app, pool) {

  // Health for the vertical
  app.get('/api/life/stats', requireAdminKey, async (req, res) => {
    try {
      const [pending, called, qualified, total] = await Promise.all([
        prisma.lead.count({ where: { vertical: 'life_fe', status: 'pending' } }),
        prisma.lead.count({ where: { vertical: 'life_fe', status: { in: ['called', 'calling'] } } }),
        prisma.lead.count({ where: { vertical: 'life_fe', status: 'qualified' } }),
        prisma.lead.count({ where: { vertical: 'life_fe' } })
      ]);
      const emailsSent = await prisma.lead.count({ where: { vertical: 'life_fe', quoteEmailSent: true } });
      ok(res, { total, pending, called, qualified, emailsSent });
    } catch (e) { bad(res, 500, e.message); }
  });

  // Manual scrape trigger: POST /api/life/scrape { niche, city, pages }
  app.post('/api/life/scrape', requireAdminKey, async (req, res) => {
    try {
      const { niche, city, pages = 1 } = req.body || {};
      if (!niche || !city) return bad(res, 400, 'niche and city required');
      const r = await importQuery(pool, { niche, city, pages: Math.min(pages, 5) });
      ok(res, r);
    } catch (e) { bad(res, 500, e.message); }
  });

  // Sweep pending life leads into the call queue: POST /api/life/sweep { limit, delayMs }
  app.post('/api/life/sweep', requireAdminKey, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.body?.limit || '20', 10), 100);
      const spacing = parseInt(req.body?.delayMs || '12000', 10);   // 12s drip
      const leads = await prisma.lead.findMany({
        where: { vertical: 'life_fe', status: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: { id: true, name: true, phone: true }
      });
      for (let i = 0; i < leads.length; i++) {
        await callQueue.add('make-call', { leadId: leads[i].id },
          { delay: 5000 + i * spacing, priority: 5, jobId: 'sweep-' + leads[i].id });
      }
      ok(res, { queued: leads.length, spacingMs: spacing });
    } catch (e) { bad(res, 500, e.message); }
  });

  // Send the quotes email manually: POST /api/life/send-quotes { leadId }
  app.post('/api/life/send-quotes', requireAdminKey, async (req, res) => {
    try {
      const { leadId } = req.body || {};
      if (!leadId) return bad(res, 400, 'leadId required');
      const lead = await prisma.lead.findUnique({ where: { id: leadId } });
      if (!lead || lead.vertical !== 'life_fe') return bad(res, 404, 'life lead not found');
      if (!lead.email) return bad(res, 400, 'lead has no email');
      const html = quotesEmailHtml(lead);
      await brevoEmail(lead.email, 'Your life insurance options — David Hughes Insurance', html);
      await prisma.lead.update({ where: { id: lead.id }, data: { quoteEmailSent: true } });
      ok(res, { sent: true, to: lead.email });
    } catch (e) { bad(res, 500, e.message); }
  });

  // Preview the quotes email in-browser (admin): GET /api/life/preview-quotes/:leadId
  app.get('/api/life/preview-quotes/:leadId', requireAdminKey, async (req, res) => {
    try {
      const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId } });
      if (!lead || lead.vertical !== 'life_fe') return bad(res, 404, 'life lead not found');
      res.type('html').send(quotesEmailHtml(lead));
    } catch (e) { bad(res, 500, e.message); }
  });

  // List life leads w/ fact-find: GET /api/life/leads?status=qualified&limit=50
  app.get('/api/life/leads', requireAdminKey, async (req, res) => {
    try {
      const { status, limit = 50 } = req.query;
      const where = { vertical: 'life_fe' };
      if (status) where.status = status;
      const leads = await prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(parseInt(limit, 10), 200),
        select: {
          id: true, name: true, phone: true, email: true, city: true, state: true,
          occupation: true, status: true, qualified: true,
          age: true, smoker: true, monthlyPremium: true, coverageAmount: true,
          quoteEmailSent: true, lastDisposition: true, callAttempts: true, createdAt: true
        }
      });
      ok(res, { count: leads.length, leads });
    } catch (e) { bad(res, 500, e.message); }
  });

  // Manual test call into the LIFE pipeline: POST /api/life/test-call/:phone?force=true
  app.post('/api/life/test-call/:phone', requireAdminKey, async (req, res) => {
    try {
      const phone = formatPhoneE164(req.params.phone);
      if (!phone) return bad(res, 400, 'Invalid phone number');
      const force = req.query.force === 'true';

      const lead = await prisma.lead.create({
        data: {
          name: 'Dave Test',
          phone,
          email: OWNER_EMAIL,
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
      ok(res, { leadId: lead.id, force, queued: true });
    } catch (e) { bad(res, 500, e.message); }
  });

  console.log('💚 Life routes attached: /api/life/{stats,scrape,sweep,send-quotes,preview-quotes,leads,test-call}');
}

module.exports = { attachLifeRoutes };
