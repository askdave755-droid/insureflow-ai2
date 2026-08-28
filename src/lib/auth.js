// ─── AUTH / SECURITY HARDENING (Phase 1) ─────────────────────────────
// Central auth guards. Every non-public endpoint passes through here.
const crypto = require('crypto');
const config = require('../config');

// Evaluated at call time (not module load) so tests and boot-order
// differences can't freeze the wrong value.
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Admin-key guard for all /admin/* and /test-* endpoints.
// HEADER ONLY: x-admin-key. The ?key= query form was removed — query
// strings leak into access logs, browser history, and referrer headers.
// 401s are intentionally generic: no key-length diagnostics (those told
// an attacker whether a key was configured and how long it was).
// Fails closed: if ADMIN_API_KEY is unset, every guarded route 401s.
function requireAdminKey(req, res, next) {
  const provided = req.headers['x-admin-key'];
  if (!config.ADMIN_API_KEY || !provided || !safeEqual(String(provided), String(config.ADMIN_API_KEY))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Webhook secret verification.
// Fail CLOSED when the secret is configured but doesn't match (always).
// Fail CLOSED in production when the secret is NOT configured — an
// unauthenticated webhook in prod lets anyone trigger calls/ingest PII.
// Non-production without a secret: loud warning, allow (local dev only).
function verifyWebhookSecret({ secret, provided, label }) {
  if (!secret) {
    if (isProduction()) {
      console.error(`🚨 ${label} webhook secret NOT configured in production — request REJECTED (fail closed). Set the secret in env.`);
      return false;
    }
    console.warn(`⚠️ ${label} webhook secret NOT configured — endpoint is unauthenticated (allowed in non-production only). Set it in env.`);
    return true;
  }
  return !!(provided && safeEqual(String(provided), String(secret)));
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

// Brevo inbound SMS: shared secret as x-brevo-secret header,
// Authorization: Bearer, or ?secret= embedded in the webhook URL.
// NOTE: BREVO_WEBHOOK_SECRET is read from process.env directly because
// src/config.js (owned by another track) does not export it yet — switch
// to the config export once it lands (SPEC §7).
function verifyBrevoWebhook(req, res, next) {
  const secret = config.BREVO_WEBHOOK_SECRET || process.env.BREVO_WEBHOOK_SECRET;
  const provided = req.headers['x-brevo-secret']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    || req.query.secret;
  if (!verifyWebhookSecret({ secret, provided, label: 'Brevo' })) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  next();
}

function actorFromRequest(req, fallback = 'system') {
  if (req.headers['x-admin-key']) return 'admin';
  if (req.path.includes('vapi')) return 'webhook:vapi';
  if (req.path.includes('phantom')) return 'webhook:phantom';
  if (req.path.includes('brevo')) return 'webhook:brevo';
  return fallback;
}

module.exports = {
  requireAdminKey,
  verifyWebhookSecret,
  verifyVapiWebhook,
  verifyPhantomWebhook,
  verifyBrevoWebhook,
  actorFromRequest,
  safeEqual
};
