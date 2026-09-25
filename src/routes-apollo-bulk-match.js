// routes-apollo-bulk-match.js — admin Apollo people bulk_match proxy.
// POST /admin/apollo/bulk-match?key=<ADMIN_API_KEY>
// Body: { "details": [{ name|first_name+last_name, organization_name, city, state }] }
// Proxies to Apollo people/bulk_match using Railway's APOLLO_API_KEY and returns
// the raw Apollo response.
const express = require('express');
const { requireAdminKey } = require('./lib/auth');

const router = express.Router();

// Apollo master-key API base (NOT /v1 — /v1 404s on this deployment's plan).
const APOLLO = 'https://api.apollo.io/api/v1';
const H = () => ({
  'X-Api-Key': process.env.APOLLO_API_KEY,
  'Content-Type': 'application/json',
  accept: 'application/json',
  'Cache-Control': 'no-cache'
});

router.post('/apollo/bulk-match', requireAdminKey, async (req, res) => {
  try {
    if (!process.env.APOLLO_API_KEY) {
      return res.status(503).json({ error: 'APOLLO_API_KEY not set' });
    }
    const details = Array.isArray(req.body?.details) ? req.body.details : [];
    if (!details.length) return res.status(400).json({ error: 'details array required' });
    if (details.length > 10) return res.status(400).json({ error: 'max 10 details per call' });

    const r = await fetch(`${APOLLO}/people/bulk_match`, {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({ details })
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    res.status(r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
