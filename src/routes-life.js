// ═══════════════════════════════════════════════
// LIFE VERTICAL ROUTES — Russell-method fact-find
// Mounted at / — all paths prefixed /api/life
// ═══════════════════════════════════════════════

const express = require('express');
const { z } = require('zod');
const prisma = require('./db');
const { callQueue } = require('./queue');
const { formatPhoneE164 } = require('./lib/validate');
const { scrapeOccupation, sendLifeFollowUp, extractLifeFactFind, factFindScore } = require('./lib/life');
const { requireAdminKey, actorFromRequest } = require('./lib/auth');
const config = require('./config');

const router = express.Router();

// ─── ADD LIFE LEAD (manual / from scraper) ───
router.post('/api/life/leads', async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    phone: z.string(),
    email: z.string().email().optional(),
    company: z.string().optional(),
    occupation: z.string().optional(),   // maps to lead.industry
    state: z.string().length(2).toUpperCase(),
    city: z.string().optional(),
    source: z.string().default('life_manual'),
    autoCall: z.boolean().default(true)
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const data = parsed.data;
  const phone = formatPhoneE164(data.phone);
  if (!phone) return res.status(400).json({ error: 'Invalid phone number' });

  if (!config.ALLOWED_STATES.includes(data.state)) {
    return res.status(400).json({ error: `State ${data.state} not licensed/allowed`, allowed: config.ALLOWED_STATES });
  }

  // Dedupe on open leads
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
      industry: data.occupation,   // occupation rides on industry column
      state: data.state,
      city: data.city,
      insuranceType: 'life',
      source: data.source,
      status: 'pending'
    }
  });

  let queued = false;
  if (data.autoCall) {
    await callQueue.add('make-call', { leadId: lead.id }, { delay: 5000, priority: 5 });
    queued = true;
  }

  console.log(`💚 Life lead created: ${lead.name} (${data.occupation || 'unknown occ'}, ${lead.state}) — queued: ${queued}`);
  res.json({ success: true, leadId: lead.id, queued });
});

// ─── HASDATA SCRAPE → LIFE LEADS ───
// POST /api/life/scrape { category, city, state, limit?, autoCall? }
// Categories idea list: "roofing contractor", "landscaping",
// "trucking company", "auto repair shop", "restaurant owner"...
router.post('/api/life/scrape', requireAdminKey, async (req, res) => {
  const schema = z.object({
    category: z.string().min(3),
    city: z.string().min(2),
    state: z.string().length(2).toUpperCase(),
    limit: z.number().min(1).max(100).default(20),
    autoCall: z.boolean().default(true)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { category, city, state, limit, autoCall } = parsed.data;

  if (!config.ALLOWED_STATES.includes(state)) {
    return res.status(400).json({ error: `State ${state} not licensed/allowed`, allowed: config.ALLOWED_STATES });
  }

  try {
    const results = await scrapeOccupation({ category, city, state, limit });
    let created = 0, skipped = 0, queued = 0;

    for (const r of results) {
      const phone = formatPhoneE164(r.phone);
      if (!phone) { skipped++; continue; }
      const existing = await prisma.lead.findFirst({
        where: { phone, status: { notIn: ['closed', 'compliance_hold'] } }
      });
      if (existing) { skipped++; continue; }

      const lead = await prisma.lead.create({
        data: {
          name: r.name || 'Business Owner',
          phone,
          company: r.name,
          industry: category,
          state,
          city,
          insuranceType: 'life',
          source: 'hasdata_maps',
          status: 'pending'
        }
      });
      created++;
      if (autoCall) {
        await callQueue.add('make-call', { leadId: lead.id }, { delay: 5000 + created * 1000, priority: 10 });
        queued++;
      }
    }

    console.log(`💚 Life scrape [${category} / ${city}, ${state}]: ${created} created, ${queued} queued, ${skipped} skipped of ${results.length}`);
    res.json({ success: true, found: results.length, created, queued, skipped });
  } catch (error) {
    console.error('❌ Life scrape failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── MANUAL FACT-FIND ENTRY (Dave, post-conversation) ───
router.post('/api/life/factfind/:leadId', requireAdminKey, async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const schema = z.object({
    age: z.number().min(18).max(85).optional(),
    tobacco: z.boolean().optional(),
    healthFlags: z.array(z.string()).optional(),
    coverageGoal: z.number().optional(),
    dependents: z.number().optional(),
    hasSpouse: z.boolean().optional(),
    existingCoverage: z.string().optional(),
    monthlyBudget: z.number().optional(),
    notes: z.string().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const ff = await prisma.lifeFactFind.upsert({
    where: { leadId: lead.id },
    create: { leadId: lead.id, ...parsed.data, score: factFindScore(parsed.data), source: 'manual' },
    update: { ...parsed.data, score: factFindScore(parsed.data) }
  });

  res.json({ success: true, factFind: ff });
});

// ─── LIST FACT-FINDS ───
router.get('/api/life/factfinds', requireAdminKey, async (req, res) => {
  const { minScore = 0, limit = 50 } = req.query;
  const factFinds = await prisma.lifeFactFind.findMany({
    where: { score: { gte: parseInt(minScore) } },
    orderBy: { createdAt: 'desc' },
    take: parseInt(limit),
    include: { lead: { select: { id: true, name: true, phone: true, email: true, company: true, state: true, industry: true, status: true } } }
  });
  res.json(factFinds);
});

// ─── RE-SEND INSUREMENOW LINK ───
router.post('/api/life/factfind/:leadId/resend', requireAdminKey, async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.leadId }, include: { lifeFactFind: true } });
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  await sendLifeFollowUp(lead, lead.lifeFactFind || {});
  res.json({ success: true, sentTo: { phone: lead.phone, email: lead.lifeFactFind?.email || lead.email } });
});

// ─── BROWSER-FRIENDLY LIFE TEST CALL ───
router.get('/api/life/test-call/:phone', requireAdminKey, async (req, res) => {
  try {
    const phone = formatPhoneE164(req.params.phone);
    if (!phone) return res.status(400).json({ error: 'Invalid phone number' });
    const force = req.query.force === 'true';

    const lead = await prisma.lead.create({
      data: {
        name: 'Dave Test',
        phone,
        email: 'askdave755@gmail.com',
        company: 'Test Roofing Co',
        industry: 'roofing contractor',
        state: 'MI',
        insuranceType: 'life',
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

// ─── LIFE STATS ───
router.get('/api/life/stats', requireAdminKey, async (req, res) => {
  const [total, qualified, factFinds, avgScore] = await Promise.all([
    prisma.lead.count({ where: { insuranceType: 'life' } }),
    prisma.lead.count({ where: { insuranceType: 'life', qualified: true } }),
    prisma.lifeFactFind.count(),
    prisma.lifeFactFind.aggregate({ _avg: { score: true } })
  ]);
  res.json({ totalLeads: total, qualified, factFinds, avgFactFindScore: Math.round(avgScore._avg.score || 0) });
});

module.exports = router;
