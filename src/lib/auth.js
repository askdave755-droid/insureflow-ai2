// ─── AUTH / SECURITY HARDENING (Phase 1) ─────────────────────────────
// Central auth guards. Every non-public endpoint passes through here.
const crypto = require('crypto');
const config = require('../config');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Admin-key guard for all /admin/* and /test-* endpoints.
// Diagnostic-friendly 401: reveals whether the env key is loaded and the
// provided length (never the value) so config issues are debuggable.
function requireAdminKey(req, res, next) {
  const provided = req.headers['x-admin-key'];
  if (!config.ADMIN_API_KEY || !provided || !safeEqual(String(provided), String(config.ADMIN_API_KEY))) {
    return res.status(401).json({
      error: 'Unauthorized',
      keyConfigured: !!config.ADMIN_API_KEY,
      expectedLength: config.ADMIN_API_KEY ? String(config.ADMIN_API_KEY).length : 0,
      providedLength: provided ? String(provided).length : 0
    });
  }
  next();
}

// Webhook secret verification. Fails CLOSED when the secret is configured
// but doesn't match; logs a loud warning when not configured (dev mode).
function verifyWebhookSecret({ secret, provided, label }) {
  if (!secret) {
    console.warn(`⚠️ ${label} webhook secret NOT configured — endpoint is unauthenticated. Set it in env.`);
    return true;
  }
  return provided && safeEqual(String(provided), String(secret));
}

// Vapi: secret sent as x-vapi-secret header or Authorization: Bearer.
function verifyVapiWebhook(req, res, next) {
  const provided = req.headers['x-vapi-secret']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!verifyWebhookSecret({ secret: config.VAPI_WEBHOOK_SECRET, provided, label: 'Vapi' })) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  next();
}

// Phantom Buster: shared secret as ?secret= query param or x-phantom-secret.
function verifyPhantomWebhook(req, res, next) {
  const provided = req.query.secret || req.headers['x-phantom-secret'];
  if (!verifyWebhookSecret({ secret: config.PHANTOM_WEBHOOK_SECRET, provided, label: 'Phantom' })) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  next();
}

function actorFromRequest(req, fallback = 'system') {
  if (req.headers['x-admin-key']) return 'admin';
  if (req.path.includes('vapi')) return 'webhook:vapi';
  if (req.path.includes('phantom')) return 'webhook:phantom';
  return fallback;
}

module.exports = {
  requireAdminKey,
  verifyVapiWebhook,
  verifyPhantomWebhook,
  actorFromRequest,
  safeEqual
};
