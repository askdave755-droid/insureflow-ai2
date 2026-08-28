// ─── PHASE 1 CLIENT (TENANCY) + INSTANTLY WEBHOOK ROUTES ─────────────
// Mounted in src/server.js via `app.use(clientRoutes)`. All /admin/clients*
// endpoints require the admin key; /webhook/instantly is public at the path
// level but protected by verifyInstantlyWebhook (fail-closed in production).
const express = require('express');
const { z } = require('zod');
const prisma = require('./db');
const config = require('./config');
const { requireAdminKey, safeEqual } = require('./lib/auth');
const { getClientRuntimeConfig } = require('./lib/tenancy');
const { normalizeInstantlyEvent, upsertAgencyProspectFromEvent } = require('./lib/instantly');

const router = express.Router();

// ─── Instantly webhook verification ──────────────────────────────────
// NOTE: implemented here (not in lib/auth.js) because auth.js is owned by
// the security track. If a canonical verifyInstantlyWebhook lands in
// lib/auth.js later, switch this import to that implementation.
// Fail-closed: in production a missing INSTANTLY_WEBHOOK_SECRET rejects all
// requests; in non-production it warns and allows (matches Vapi/Phantom).
function verifyInstantlyWebhook(req, res, next) {
  const secret = config.INSTANTLY_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('🚫 Instantly webhook REJECTED — INSTANTLY_WEBHOOK_SECRET not configured (production fail-closed)');
      return res.status(401).json({ error: 'Webhook secret not configured' });
    }
    console.warn('⚠️ Instantly webhook secret NOT configured — endpoint is unauthenticated. Set INSTANTLY_WEBHOOK_SECRET.');
    return next();
  }
  const provided = req.headers['x-instantly-secret']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    || req.query.secret;
  if (!provided || !safeEqual(String(provided), String(secret))) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  next();
}

// ─── Validation ──────────────────────────────────────────────────────
const clientCreateSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric + dashes'),
  licensedStates: z.array(z.string().length(2)).default([]),
  vapiAssistantId: z.string().optional(),
  vapiPhoneNumberId: z.string().optional(),
  calendlyLink: z.string().url().optional(),
  brevoSenderName: z.string().optional(),
  brevoSenderEmail: z.string().email().optional(),
  brandingJson: z.record(z.any()).optional(),
  active: z.boolean().default(true)
});

// ─── Admin client CRUD (summary level — no secrets involved) ─────────
router.post('/admin/clients', requireAdminKey, async (req, res) => {
  try {
    const parsed = clientCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid client payload', details: parsed.error.flatten() });
    }
    const data = parsed.data;
    data.licensedStates = data.licensedStates.map((s) => s.toUpperCase());
    const client = await prisma.client.create({ data });
    console.log(`🏢 Client created: ${client.slug} (${client.id})`);
    res.status(201).json({ client });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Client slug already exists' });
    }
    console.error('❌ POST /admin/clients failed:', err.message);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

router.get('/admin/clients', requireAdminKey, async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { leads: true, accounts: true, opportunities: true, tasks: true } }
      }
    });
    res.json({ clients });
  } catch (err) {
    console.error('❌ GET /admin/clients failed:', err.message);
    res.status(500).json({ error: 'Failed to list clients' });
  }
});

// Runtime config summary for one client — safe, non-secret fields only.
router.get('/admin/clients/:id', requireAdminKey, async (req, res) => {
  try {
    const client = await prisma.client.findUnique({ where: { id: req.params.id } });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json({
      client: {
        id: client.id,
        name: client.name,
        slug: client.slug,
        active: client.active,
        createdAt: client.createdAt,
        updatedAt: client.updatedAt
      },
      runtimeConfig: getClientRuntimeConfig(client)
    });
  } catch (err) {
    console.error('❌ GET /admin/clients/:id failed:', err.message);
    res.status(500).json({ error: 'Failed to load client' });
  }
});

// ─── Instantly inbound webhook ───────────────────────────────────────
// Receives Instantly campaign events for agency-client acquisition.
// Upserts AgencyProspect; opens a follow-up Task on replied/qualified.
// Always 200s on parseable-but-unusable payloads so Instantly doesn't retry
// forever; only auth failures and unexpected 500s are non-200.
router.post('/webhook/instantly', verifyInstantlyWebhook, async (req, res) => {
  try {
    const event = normalizeInstantlyEvent(req.body);
    if (!event) {
      console.warn('⚠️ Instantly webhook: unrecognized payload shape (no email) — acknowledged');
      return res.status(200).json({ ok: false, reason: 'unrecognized payload shape' });
    }
    const result = await upsertAgencyProspectFromEvent(event);
    if (!result.ok) {
      // Upsert failed internally (DB etc.) — already logged inside the lib.
      return res.status(200).json({ ok: false, reason: result.error });
    }
    res.json({
      ok: true,
      prospectId: result.prospect.id,
      status: result.prospect.status,
      taskCreated: Boolean(result.task)
    });
  } catch (err) {
    console.error('❌ /webhook/instantly failed:', err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Optional explicit attach helper (mirrors routes-carrier.js pattern).
function attachClientRoutes(app) {
  app.use(router);
}

module.exports = router;
module.exports.attachClientRoutes = attachClientRoutes;
module.exports.verifyInstantlyWebhook = verifyInstantlyWebhook;
