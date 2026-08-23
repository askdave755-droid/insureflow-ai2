const express = require('express');
const { z } = require('zod');
const axios = require('axios');
const prisma = require('./db');
const { callQueue } = require('./queue');
const { formatPhoneE164, isBusinessHours, getNextBusinessTime } = require('./lib/validate');
const { handleVapiWebhook } = require('./workers/callWorker');
const { sendEmailBrevo } = require('./lib/messaging');
const { enrichWithFMCSA } = require('./sources/fmcsa');
const { runIntelligence } = require('./lib/intel');
const { promoteLead } = require('./lib/convert');
const { assertTransition } = require('./lib/pipeline');
const config = require('./config');
const { requireAdminKey, verifyVapiWebhook, verifyPhantomWebhook, actorFromRequest } = require('./lib/auth');
const { auditMiddleware, audit } = require('./lib/audit');
const { checkContactPermission, addToDnc, recordConsent } = require('./lib/compliance');

const router = express.Router();
router.use(auditMiddleware());

// Gate every outreach queueing decision through the compliance engine.
// queueOpts (from runIntelligence): { skip, bullPriority, reason } — a skip
// sends the lead to nurture without ever hitting the compliance engine.
// Returns { queued, delay, lead } — handles hold (schedule at retryAt) and
// blocked (compliance_hold, no queue) states.
async function complianceGateAndQueue(lead, actor, queueOpts = {}) {
  if (queueOpts.skip) {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'nurture' } });
    console.log(`🌱 Lead ${lead.id} scored DONT_WASTE_TIME — nurtured, not queued`);
    return { queued: false, nurtured: true, reasons: [queueOpts.reason || 'Score below threshold'] };
  }
  const priority = queueOpts.bullPriority || 10;
  const check = await checkContactPermission(lead, 'call', actor);
  if (check.status === 'blocked') {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'compliance_hold' } });
    console.log(`🚫 Compliance BLOCKED lead ${lead.id}: ${check.reasons.join('; ')}`);
    return { queued: false, blocked: true, reasons: check.reasons };
  }
  if (check.status === 'hold') {
    const retryAt = check.retryAt ? check.retryAt.getTime() : getNextBusinessTime(lead.state);
    const delay = Math.max(retryAt - Date.now(), 60000);
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'scheduled', scheduledCallAt: new Date(retryAt) } });
    await callQueue.add('make-call', { leadId: lead.id }, { delay, priority });
    console.log(`⏸️ Compliance HOLD lead ${lead.id} — retry scheduled ${new Date(retryAt).toISOString()}`);
    return { queued: true, held: true, delay, reasons: check.reasons };
  }
  const delay = 5000;
  await callQueue.add('make-call', { leadId: lead.id }, { delay, priority });
  return { queued: true, delay };
}

// ─── HEALTH ───
router.get('/health', async (req, res) => {
  const dbCheck = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  res.json({
    status: dbCheck ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// ─── TEST EMAIL (Brevo smoke test — browser friendly) ───
router.get('/test-email', requireAdminKey, async (req, res) => {
  try {
    if (!config.BREVO_API_KEY) {
      return res.status(500).json({ sent: false, error: 'BREVO_API_KEY is not set in config/env' });
    }

    const testLead = {
      email: 'askdave755@gmail.com',
      name: 'Dave Test',
      company: 'Test Trucking Co',
      state: 'MI'
    };

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); padding: 30px; text-align: center;">
          <h1 style="color: #fff; margin: 0; font-size: 24px;">Nexus G Partners</h1>
          <p style="color: #e0e0e0; margin: 10px 0 0;">Brevo Integration Test</p>
        </div>
        <div style="padding: 30px; background: #fff;">
          <p>This is a test email from InsureFlowAI 2.0 to verify the Brevo email path is working.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${config.CALENDLY_LINK}"
               style="background: #2d5a87; color: #fff; padding: 15px 40px; text-decoration: none; border-radius: 5px; font-size: 16px; display: inline-block;">
              Book My Comparison Call
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">If you received this, Brevo is correctly wired. 🎉</p>
        </div>
      </div>
    `;
    const text = `InsureFlowAI 2.0 Brevo test email. Book here: ${config.CALENDLY_LINK}`;

    const data = await sendEmailBrevo(testLead, 'InsureFlow Test Email', html, text);
    res.json({ sent: true, messageId: data?.messageId || null });
  } catch (error) {
    console.error('❌ /test-email failed:', error.response?.data || error.message);
    res.status(500).json({
      sent: false,
      error: error.response?.data || error.message
    });
  }
});

// ─── ADD SINGLE LEAD ───
router.post('/api/leads', async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    phone: z.string(),
    email: z.string().email().optional(),
    company: z.string().optional(),
    title: z.string().optional(),
    state: z.string().length(2).toUpperCase(),
    city: z.string().optional(),
    insuranceType: z.string().optional(),
    source: z.string().default('manual'),
    dotNumber: z.string().optional(),
    vehicleCount: z.number().optional(),
    xDate: z.string().datetime().optional()
  });
  
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  
  const data = parsed.data;
  const phone = formatPhoneE164(data.phone);
  if (!phone) return res.status(400).json({ error: 'Invalid phone number' });
  
  const lead = await prisma.lead.create({
    data: {
      ...data,
      phone,
      status: 'pending'
    }
  });

  // Phase 2 — score, tier, prioritize before compliance gate
  const intel = runIntelligence(lead);
  await prisma.lead.update({ where: { id: lead.id }, data: intel.updates });
  
  const gate = await complianceGateAndQueue(lead, actorFromRequest(req, 'api'), intel.queue);
  await req.audit({ actor: actorFromRequest(req, 'api'), action: 'create', entityType: 'Lead', entityId: lead.id, after: { name: lead.name, phone: lead.phone, state: lead.state, source: lead.source }, metadata: { gate, scores: intel.scores } });

  res.json({
    success: true,
    lead: { ...lead, ...intel.updates },
    scores: {
      riskScore: intel.scores.riskScore,
      opportunityScore: intel.scores.opportunityScore,
      combined: intel.scores.combined,
      band: intel.scores.band
    },
    xdate: intel.xdate,
    ...gate
  });
});

// ─── BROWSER-FRIENDLY TEST CALL ───
router.get('/test-call/:phone', requireAdminKey, async (req, res) => {
  try {
    const phone = formatPhoneE164(req.params.phone);
    if (!phone) return res.status(400).json({ error: 'Invalid phone number' });
    
    const force = req.query.force === 'true';
    
    const lead = await prisma.lead.create({
      data: {
        name: 'Dave Test',
        phone,
        email: 'askdave755@gmail.com',
        company: 'Test Trucking Co',
        state: 'MI',
        source: 'manual_test',
        status: 'pending'
      }
    });
    
    await callQueue.add('make-call', force ? { leadId: lead.id, force: true } : { leadId: lead.id }, { delay: 3000 });
    
    res.json({
      message: `Test call queued for ${phone} (3s delay)${force ? ' [FORCE MODE]' : ''}`,
      leadId: lead.id,
      force
    });
  } catch (error) {
    console.error('Test call error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── GET LEADS ───
router.get('/api/leads', async (req, res) => {
  const { status, state, limit = 50 } = req.query;
  
  const where = {};
  if (status) where.status = status;
  if (state) where.state = state.toUpperCase();
  
  const leads = await prisma.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: parseInt(limit),
    include: { callLogs: { orderBy: { createdAt: 'desc' }, take: 1 } }
  });
  
  res.json(leads);
});

// ─── PIPELINE VIEW (Phase 2 — prioritized prospect list) ───
// GET /api/pipeline?band=HOT&tier=STRIKE_ZONE&state=MI&minScore=60&limit=50
router.get('/api/pipeline', requireAdminKey, async (req, res) => {
  const { band, minScore, tier, state, limit = 50 } = req.query;
  const where = { status: { notIn: ['closed', 'compliance_hold'] } };
  if (band) where.scoreBand = band.toUpperCase();
  if (tier) where.xdateTier = tier.toUpperCase();
  if (state) where.state = state.toUpperCase();
  if (minScore) where.opportunityScore = { gte: parseInt(minScore) };
  const leads = await prisma.lead.findMany({
    where,
    orderBy: [{ opportunityScore: 'desc' }, { riskScore: 'desc' }],
    take: parseInt(limit),
    select: {
      id: true, name: true, company: true, phone: true, state: true, city: true,
      status: true, source: true, dotNumber: true, vehicleCount: true,
      currentCarrier: true, xDate: true, xdateTier: true,
      riskScore: true, opportunityScore: true, scoreBand: true,
      operatingRadius: true, hazmat: true, createdAt: true
    }
  });
  res.json(leads);
});

// ═══════════════════════════════════════════════════════
// PHASE 3 — SALES ENGINE ENDPOINTS
// ═══════════════════════════════════════════════════════

// ─── TASKS (Dave's to-do list) ───
// GET /api/tasks?status=open&priority=hot&dueBefore=2026-09-01&limit=50
router.get('/api/tasks', requireAdminKey, async (req, res) => {
  const { status = 'open', priority, dueBefore, limit = 50 } = req.query;
  const where = {};
  if (status !== 'all') where.status = status;
  if (priority) where.priority = priority;
  if (dueBefore) where.dueAt = { lte: new Date(dueBefore) };
  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    take: parseInt(limit),
    include: {
      lead: { select: { id: true, name: true, company: true, phone: true, state: true, scoreBand: true, xDate: true } },
      opportunity: { select: { id: true, stage: true, priority: true, xDate: true } }
    }
  });
  res.json(tasks);
});

router.post('/api/tasks/:id/done', requireAdminKey, async (req, res) => {
  const before = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Not found' });
  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: { status: 'done', completedAt: new Date() }
  });
  await req.audit({ actor: actorFromRequest(req, 'admin'), action: 'task_done', entityType: 'Task', entityId: task.id, before, after: task });
  res.json({ success: true, task });
});

// ─── MANUAL PROMOTION (lead → account + opportunity) ───
router.post('/api/leads/:id/promote', requireAdminKey, async (req, res) => {
  try {
    const result = await promoteLead(req.params.id, actorFromRequest(req, 'admin'));
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('❌ Promote failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── OPPORTUNITIES ───
// GET /api/opportunities?stage=QUALIFIED&priority=hot&limit=50
router.get('/api/opportunities', requireAdminKey, async (req, res) => {
  const { stage, priority, limit = 50 } = req.query;
  const where = {};
  if (stage) where.stage = stage.toUpperCase();
  if (priority) where.priority = priority;
  const opportunities = await prisma.opportunity.findMany({
    where,
    orderBy: [{ priority: 'asc' }, { xDate: 'asc' }],
    take: parseInt(limit),
    include: {
      account: { select: { id: true, company: true, state: true, phone: true, dotNumber: true, vehicleCount: true } },
      lead: { select: { id: true, name: true, phone: true, email: true, scoreBand: true, lastDisposition: true } }
    }
  });
  res.json(opportunities);
});

// Move an opportunity through the pipeline — illegal jumps are rejected
router.post('/api/opportunities/:id/stage', requireAdminKey, async (req, res) => {
  const { stage, lostReason } = req.body || {};
  if (!stage) return res.status(400).json({ error: 'stage required' });

  const before = await prisma.opportunity.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Not found' });

  try {
    assertTransition('Opportunity', before.stage, stage.toUpperCase());
  } catch (err) {
    return res.status(400).json({ error: err.message, from: before.stage, to: stage });
  }

  const data = { stage: stage.toUpperCase() };
  if (stage.toUpperCase() === 'LOST') {
    data.lostReason = lostReason || null;
    data.closedAt = new Date();
  }
  if (stage.toUpperCase() === 'BOUND') data.closedAt = new Date();

  const opportunity = await prisma.opportunity.update({ where: { id: req.params.id }, data });
  await req.audit({
    actor: actorFromRequest(req, 'admin'),
    action: 'stage_change',
    entityType: 'Opportunity',
    entityId: opportunity.id,
    before: { stage: before.stage },
    after: { stage: opportunity.stage, lostReason: opportunity.lostReason }
  });
  res.json({ success: true, opportunity });
});

// ─── VAPI WEBHOOK ───
router.post('/webhook/vapi/done', verifyVapiWebhook, async (req, res) => {
  try {
    const result = await handleVapiWebhook(req.body);
    res.json({ received: true, ...result });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ received: true, error: error.message });
  }
});

// ─── PHANTOM BUSTER WEBHOOK ───
// Google Maps Search Export results: parse US state out of an address string.
function parseStateFromItem(item) {
  if (item.state && typeof item.state === 'string') {
    const m = item.state.toUpperCase().match(/\b[A-Z]{2}\b/);
    if (m) return m[0];
  }
  const addr = item.address || item.fullAddress || item.location || '';
  // e.g. "123 Main St, Detroit, MI 48201" or "Houston, TX"
  const m = String(addr).match(/,\s*([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?\s*$/i)
         || String(addr).match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/i);
  return m ? m[1].toUpperCase() : null;
}

// National megacarriers & chains that will never buy from an independent
// agent — skip them so Brady doesn't burn Vapi minutes on 800-numbers.
// Matched as case-insensitive substrings against the business name.
const SKIP_BUSINESS_NAMES = [
  'fedex', 'ups', 'usps', 'dhl',
  'old dominion', 'abf freight', 'estes express', 'saia', 'tforce',
  'xpo', 'r+l carriers', 'r + l carriers', 'usf holland', 'yrc',
  'schneider national', 'j.b. hunt', 'jb hunt', 'swift transportation',
  'knight transportation', 'knight-swift', 'werner enterprises',
  'landstar', 'prime inc', 'crst', 'crete carrier', 'forward air',
  'dayton freight', 'pitt ohio', 'southeastern freight',
  'central transport', 'central freight', 'roadrunner',
  'two men and a truck', 'college hunks', 'u-haul', 'uhaul',
  'penske truck rental', 'ryder truck rental', 'budget truck'
];

function isSkippableBusiness(name) {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return SKIP_BUSINESS_NAMES.some(skip => n.includes(skip));
}

// Parse a value that may be an array OR a JSON-encoded string of an array.
function parseMaybeStringArray(raw) {
  if (Array.isArray(raw) && raw.length) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch (e) {
        console.warn('⚠️ Could not parse JSON string result payload:', e.message);
      }
    }
  }
  return null;
}

// Pull a resultObject array out of a fetch-output API response, defensively.
function extractResultObject(data) {
  if (!data) return null;
  const direct = parseMaybeStringArray(data.resultObject) || parseMaybeStringArray(data.results);
  if (direct) return direct;
  const out = data.output;
  if (out && typeof out === 'object') {
    const nested = parseMaybeStringArray(out.resultObject);
    if (nested) return nested;
  }
  if (typeof out === 'string') {
    // Output may be log text with JSON containing resultObject embedded
    const idx = out.indexOf('"resultObject"');
    if (idx !== -1) {
      // Try parsing the whole string first
      try {
        const parsed = JSON.parse(out);
        const nested = parseMaybeStringArray(parsed?.resultObject);
        if (nested) return nested;
      } catch (_) { /* not full JSON */ }
      // Fallback: find the array start after "resultObject":
      try {
        const arrStart = out.indexOf('[', idx);
        if (arrStart !== -1) {
          // Find matching closing bracket
          let depth = 0, inStr = false, esc = false;
          for (let i = arrStart; i < out.length; i++) {
            const c = out[i];
            if (inStr) {
              if (esc) esc = false;
              else if (c === '\\') esc = true;
              else if (c === '"') inStr = false;
            } else if (c === '"') inStr = true;
            else if (c === '[') depth++;
            else if (c === ']') {
              depth--;
              if (depth === 0) {
                const arr = JSON.parse(out.slice(arrStart, i + 1));
                if (Array.isArray(arr) && arr.length) return arr;
                break;
              }
            }
          }
        }
      } catch (e) {
        console.warn('⚠️ Failed to parse resultObject from output string:', e.message);
      }
    }
  }
  return null;
}

router.post('/webhook/phantom', verifyPhantomWebhook, async (req, res) => {
  try {
    console.log('👻 Phantom webhook received:', JSON.stringify(Object.keys(req.body || {})), JSON.stringify(req.body).slice(0, 500));

    const body = req.body || {};

    // Case A: results included directly in the webhook body.
    // Phantom sends resultObject as a JSON-encoded STRING in completion
    // notifications — parse string form as well as array form.
    let results = parseMaybeStringArray(body.resultObject)
               || parseMaybeStringArray(body.results);

    // Case B: completion NOTIFICATION — must fetch actual results from Phantom API
    if (!results) {
      const agentId = body.agentId || body.agent_id || body.agent
                   || body.data?.agentId || body.data?.agent_id || null;

      if (agentId) {
        if (!config.PHANTOM_API_KEY) {
          console.warn('⚠️ Phantom completion notification received but PHANTOM_API_KEY is not set — cannot fetch results.');
          return res.json({ received: true, processed: 0, queued: 0, reason: 'no PHANTOM_API_KEY' });
        }

        console.log(`👻 Phantom completion notification for agent ${agentId} — fetching output...`);
        try {
          const resp = await axios.get('https://api.phantombuster.com/api/v2/agents/fetch-output', {
            params: { id: agentId },
            headers: { 'X-Phantombuster-Key': config.PHANTOM_API_KEY },
            timeout: 20000
          });
          results = extractResultObject(resp.data);
          if (!results) {
            console.warn('⚠️ Phantom fetch-output returned no parseable resultObject. Keys:', JSON.stringify(Object.keys(resp.data || {})));
            return res.json({ received: true, processed: 0, queued: 0, reason: 'no resultObject in fetch-output response' });
          }
        } catch (err) {
          console.error('❌ Phantom fetch-output failed:', err.response?.status, err.response?.data || err.message);
          // Still 200 — don't let Phantom retry-storm us
          return res.json({ received: true, processed: 0, queued: 0, reason: 'fetch-output error', error: err.message });
        }
      } else {
        return res.json({ received: true, processed: 0, queued: 0, reason: 'no results and no agentId in payload' });
      }
    }

    let queued = 0;
    let skipped = 0;
    let skippedNational = 0;

    for (const item of results) {
      const phone = formatPhoneE164(item.phone || item.phoneNumber);
      if (!phone) { skipped++; continue; }

      const company = item.title || item.name || item.companyName || null;

      // Skip national megacarriers / chains — they don't buy from independents
      if (isSkippableBusiness(company)) {
        skippedNational++;
        continue;
      }

      // Dedupe: skip if an open lead with this phone already exists
      const existing = await prisma.lead.findFirst({
        where: { phone, status: { not: 'closed' } }
      });
      if (existing) { skipped++; continue; }

      // Default to MI (primary market) when the address can't be parsed —
      // never silently tag a lead with the wrong state's calling-hours rules.
      const state = (parseStateFromItem(item) || body.state || 'MI').toUpperCase();

      const lead = await prisma.lead.create({
        data: {
          name: item.title || item.name || 'Business Owner',
          phone,
          email: item.email,
          company,
          state,
          city: item.city,
          source: 'phantom',
          status: 'pending'
        }
      });

      // FMCSA enrichment — best-effort, never blocks queueing
      try {
        const fmcsa = await enrichWithFMCSA({
          name: lead.name,
          company: lead.company,
          state: lead.state,
          phone: lead.phone
        });
        if (fmcsa) {
          await prisma.lead.update({ where: { id: lead.id }, data: fmcsa });
          Object.assign(lead, fmcsa);
          console.log(`🛡️ FMCSA enriched: ${lead.company || lead.name} DOT#${fmcsa.dotNumber} ${fmcsa.authorityStatus || ''}`.trim());
        }
      } catch (err) {
        console.warn(`⚠️ FMCSA enrichment failed for lead ${lead.id}: ${err.message}`);
      }

      // Phase 2 — score, tier, prioritize before compliance gate
      const intel = runIntelligence(lead);
      await prisma.lead.update({ where: { id: lead.id }, data: intel.updates });

      const gate = await complianceGateAndQueue(lead, 'webhook:phantom', intel.queue);
      if (gate.blocked || gate.nurtured) { skipped++; continue; }
      queued++;
    }

    console.log(`✅ Phantom webhook: ${queued} leads queued, ${skipped} skipped (dup/no-phone), ${skippedNational} national-carrier skips, of ${results.length}`);
    res.json({ received: true, processed: results.length, queued, skipped, skippedNational });
  } catch (error) {
    console.error('❌ Phantom webhook error:', error);
    res.status(200).json({ received: true, queued: 0, error: error.message });
  }
});

// ─── ADMIN: PAUSE / RESUME ───
router.get('/admin/pause', requireAdminKey, (req, res) => {
  callQueue.pause();
  res.json({ status: 'paused', message: 'Call queue paused' });
});

router.get('/admin/resume', requireAdminKey, (req, res) => {
  callQueue.resume();
  res.json({ status: 'active', message: 'Call queue resumed' });
});

router.get('/admin/status', requireAdminKey, async (req, res) => {
  // Never hang: if Redis/Bull is unresponsive, fall back after 5s.
  let counts;
  try {
    counts = await Promise.race([
      callQueue.getJobCounts(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('getJobCounts timeout')), 5000))
    ]);
  } catch (err) {
    counts = { error: err.message, unavailable: true };
  }
  
  let stats = null;
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    stats = await prisma.dailyStat.findUnique({ where: { date: today } });
  } catch (err) {
    console.error('dailyStat lookup failed:', err.message);
  }
  
  res.json({
    queue: counts,
    today: stats || { leadsIngested: 0, callsMade: 0, qualified: 0 },
    system: 'operational'
  });
});

// ─── COST DASHBOARD ───
router.get('/admin/costs', requireAdminKey, async (req, res) => {
  const costs = await prisma.cost.groupBy({
    by: ['type'],
    _sum: { amount: true },
    _count: true
  });
  
  res.json(costs);
});

// ─── NUCLEAR RESET ───
router.post('/admin/nuclear-reset', requireAdminKey, async (req, res) => {
  await prisma.callLog.deleteMany();
  await prisma.task.deleteMany();
  await prisma.cost.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.dailyStat.deleteMany();

  await req.audit({ actor: 'admin', action: 'nuclear_reset', entityType: 'System', entityId: 'all' });
  res.json({ reset: true, message: 'All data cleared' });
});

// ─── TARGETED CLEANUP ───
// Deletes ONLY junk: test leads (manual_test + webhook self-tests) and
// national-carrier/chain leads. Real scraped leads are kept. Requires
// x-admin-key header like nuclear-reset.
router.post('/admin/cleanup', requireAdminKey, async (req, res) => {
  try {
    // 1) Test leads by source
    const byTestSource = await prisma.lead.deleteMany({
      where: { source: { in: ['manual_test'] } }
    });

    // 2) Webhook/self-test dummies by name
    const byTestName = await prisma.lead.deleteMany({
      where: {
        OR: [
          { name: { contains: 'Self Test', mode: 'insensitive' } },
          { name: { contains: 'String Parse Test', mode: 'insensitive' } },
          { name: { contains: 'Mike Trucker', mode: 'insensitive' } },
          { name: { contains: 'Dave Test', mode: 'insensitive' } },
          { company: { contains: 'Test Trucking Co', mode: 'insensitive' } }
        ]
      }
    });

    // 3) National carriers / chains that slipped in before the skip filter
    let nationalDeleted = 0;
    const nationals = await prisma.lead.findMany({
      select: { id: true, name: true, company: true }
    });
    const junkIds = nationals
      .filter(l => isSkippableBusiness(l.company) || isSkippableBusiness(l.name))
      .map(l => l.id);
    if (junkIds.length) {
      const r = await prisma.lead.deleteMany({ where: { id: { in: junkIds } } });
      nationalDeleted = r.count;
    }

    const remaining = await prisma.lead.count();
    console.log(`🧹 Cleanup: ${byTestSource.count} test-source, ${byTestName.count} test-name, ${nationalDeleted} national — ${remaining} leads remain`);

    res.json({
      cleaned: true,
      deleted: {
        testSource: byTestSource.count,
        testName: byTestName.count,
        nationalCarriers: nationalDeleted
      },
      remaining
    });
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    res.status(500).json({ cleaned: false, error: error.message });
  }
});

// ─── COMPLIANCE MANAGEMENT (admin) ───
// Add to internal DNC: { phone } or { email }, optional reason/source
router.post('/admin/dnc', requireAdminKey, async (req, res) => {
  const { phone, email, reason, source } = req.body || {};
  if (!phone && !email) return res.status(400).json({ error: 'phone or email required' });
  const entry = await addToDnc({ phone: phone ? formatPhoneE164(phone) : null, email, reason, source }, 'admin');
  res.json({ success: true, entry });
});

router.get('/admin/dnc', requireAdminKey, async (req, res) => {
  const entries = await prisma.dncEntry.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
  res.json(entries);
});

router.delete('/admin/dnc/:id', requireAdminKey, async (req, res) => {
  const before = await prisma.dncEntry.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Not found' });
  await prisma.dncEntry.delete({ where: { id: req.params.id } });
  await req.audit({ actor: 'admin', action: 'dnc_removed', entityType: 'DncEntry', entityId: req.params.id, before });
  res.json({ removed: true });
});

// Record consent (e.g. verbal opt-in captured on a call)
router.post('/api/consent', requireAdminKey, async (req, res) => {
  const { leadId, phone, channel = 'sms', granted = true, consentType, proofText, source } = req.body || {};
  if (!phone && !leadId) return res.status(400).json({ error: 'leadId or phone required' });
  const event = await recordConsent({ leadId, phone: phone ? formatPhoneE164(phone) : null, channel, granted, consentType, proofText, source }, 'admin');
  // Consent may release a held lead
  if (granted && leadId) {
    await prisma.lead.updateMany({ where: { id: leadId, complianceStatus: 'hold' }, data: { complianceStatus: 'clear', complianceNotes: 'Consent recorded — hold released' } });
  }
  res.json({ success: true, event });
});

// ─── AUDIT TRAIL VIEWER (admin) ───
router.get('/admin/audit', requireAdminKey, async (req, res) => {
  const { entityType, entityId, limit = 100 } = req.query;
  const where = {};
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  const logs = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: parseInt(limit) });
  res.json(logs);
});

module.exports = router;
