const express = require('express');
const { z } = require('zod');
const axios = require('axios');
const prisma = require('./db');
const { callQueue } = require('./queue');
const { formatPhoneE164, isBusinessHours, getNextBusinessTime } = require('./lib/validate');
const { handleVapiWebhook } = require('./workers/callWorker');
const { sendEmailBrevo } = require('./lib/messaging');
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

// ─── TEST EMAIL (Brevo smoke test — browser friendly) ───
router.get('/test-email', async (req, res) => {
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
          <h1 style="color: #fff; margin: 0; font-size: 24px;">Smart Choice Agents</h1>
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

// Pull a resultObject array out of a fetch-output API response, defensively.
function extractResultObject(data) {
  if (!data) return null;
  if (Array.isArray(data.resultObject) && data.resultObject.length) return data.resultObject;
  if (Array.isArray(data.results) && data.results.length) return data.results;
  const out = data.output;
  if (out && typeof out === 'object') {
    if (Array.isArray(out.resultObject) && out.resultObject.length) return out.resultObject;
  }
  if (typeof out === 'string') {
    // Output may be a string containing JSON with resultObject embedded
    const idx = out.indexOf('"resultObject"');
    if (idx !== -1) {
      // Try parsing the whole string first
      try {
        const parsed = JSON.parse(out);
        if (Array.isArray(parsed?.resultObject) && parsed.resultObject.length) return parsed.resultObject;
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

router.post('/webhook/phantom', async (req, res) => {
  try {
    console.log('👻 Phantom webhook received:', JSON.stringify(Object.keys(req.body || {})), JSON.stringify(req.body).slice(0, 500));

    const body = req.body || {};

    // Case A: results included directly in the webhook body
    let results = (Array.isArray(body.resultObject) && body.resultObject.length ? body.resultObject : null)
               || (Array.isArray(body.results) && body.results.length ? body.results : null);

    // Case B: completion NOTIFICATION — must fetch actual results from Phantom API
    if (!results) {
      const agentId = body.agentId || body.agent_id || body.data?.agentId || body.data?.agent_id || null;

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

    for (const item of results) {
      const phone = formatPhoneE164(item.phone || item.phoneNumber);
      if (!phone) { skipped++; continue; }

      // Dedupe: skip if an open lead with this phone already exists
      const existing = await prisma.lead.findFirst({
        where: { phone, status: { not: 'closed' } }
      });
      if (existing) { skipped++; continue; }

      const company = item.title || item.name || item.companyName || null;
      const state = (parseStateFromItem(item) || body.state || 'TX').toUpperCase();

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

      const delay = isBusinessHours(lead.state) ? 5000 : getNextBusinessTime(lead.state) - Date.now();
      await callQueue.add('make-call', { leadId: lead.id }, { delay: Math.max(delay, 0) });
      queued++;
    }

    console.log(`✅ Phantom webhook: ${queued} leads queued, ${skipped} skipped (dup/no-phone) of ${results.length}`);
    res.json({ received: true, processed: results.length, queued, skipped });
  } catch (error) {
    console.error('❌ Phantom webhook error:', error);
    res.status(200).json({ received: true, queued: 0, error: error.message });
  }
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
