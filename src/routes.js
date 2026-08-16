const express = require('express');
const { z } = require('zod');
const prisma = require('./db');
const { callQueue } = require('./queue');
const { formatPhoneE164, isBusinessHours, getNextBusinessTime } = require('./lib/validate');
const { handleVapiWebhook } = require('./workers/callWorker');
const config = require('./config');

const router = express.Router();

// ─── HEALTH ───
router.get('/health', async (req, res) => {
  const dbCheck = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  res.json({
    status: dbCheck ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
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
  
  // Queue the call
  const delay = isBusinessHours(data.state) ? 5000 : getNextBusinessTime(data.state) - Date.now();
  await callQueue.add('make-call', { leadId: lead.id }, { delay: Math.max(delay, 0) });
  
  res.json({ success: true, lead, queued: true });
});

// ─── BROWSER-FRIENDLY TEST CALL ───
router.get('/test-call/:phone', async (req, res) => {
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
    
    await callQueue.add('make-call', { leadId: lead.id, force: true }, { delay: 3000 });
    
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

// ─── VAPI WEBHOOK ───
router.post('/webhook/vapi/done', async (req, res) => {
  try {
    const result = await handleVapiWebhook(req.body);
    res.json({ received: true, ...result });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ received: true, error: error.message });
  }
});

// ─── PHANTOM BUSTER WEBHOOK ───
router.post('/webhook/phantom', async (req, res) => {
  // Phantom sends results here. Parse and queue.
  const results = req.body.resultObject || req.body.results || [];
  
  for (const item of results) {
    const phone = formatPhoneE164(item.phone || item.phoneNumber);
    if (!phone) continue;
    
    const lead = await prisma.lead.create({
      data: {
        name: item.name || item.title || 'Unknown',
        phone,
        email: item.email,
        company: item.companyName || item.organizationName,
        state: (item.state || 'TX').toUpperCase(),
        city: item.city,
        source: 'phantom',
        status: 'pending'
      }
    });
    
    const delay = isBusinessHours(lead.state) ? 5000 : getNextBusinessTime(lead.state) - Date.now();
    await callQueue.add('make-call', { leadId: lead.id }, { delay: Math.max(delay, 0) });
  }
  
  res.json({ processed: results.length });
});

// ─── ADMIN: PAUSE / RESUME ───
router.get('/admin/pause', (req, res) => {
  callQueue.pause();
  res.json({ status: 'paused', message: 'Call queue paused' });
});

router.get('/admin/resume', (req, res) => {
  callQueue.resume();
  res.json({ status: 'active', message: 'Call queue resumed' });
});

router.get('/admin/status', async (req, res) => {
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
router.get('/admin/costs', async (req, res) => {
  const costs = await prisma.cost.groupBy({
    by: ['type'],
    _sum: { amount: true },
    _count: true
  });
  
  res.json(costs);
});

// ─── NUCLEAR RESET ───
router.post('/admin/nuclear-reset', async (req, res) => {
  if (req.headers['x-admin-key'] !== config.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  await prisma.callLog.deleteMany();
  await prisma.cost.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.dailyStat.deleteMany();
  
  res.json({ reset: true, message: 'All data cleared' });
});

module.exports = router;
