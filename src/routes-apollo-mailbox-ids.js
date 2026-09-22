// routes-apollo-mailbox-ids.js — phone-friendly Apollo mailbox ID lookup.
// GET /admin/apollo/mailbox-ids?key=<ADMIN_API_KEY>
// Lists connected mailboxes with their Apollo email account IDs, so Dave can
// copy the right value into APOLLO_SEND_EMAIL_ACCOUNT_ID in Railway.
const express = require('express');
const { requireAdminKey } = require('./lib/auth');

const router = express.Router();

// Apollo master-key API base (NOT /v1 — /v1 404s on this endpoint).
const APOLLO = 'https://api.apollo.io/api/v1';
const H = () => ({
  'X-Api-Key': process.env.APOLLO_API_KEY,
  accept: 'application/json',
  'Cache-Control': 'no-cache'
});

router.get('/apollo/mailbox-ids', requireAdminKey, async (req, res) => {
  try {
    if (!process.env.APOLLO_API_KEY) {
      return res.status(503).json({ error: 'APOLLO_API_KEY not set' });
    }
    const r = await fetch(`${APOLLO}/email_accounts?page=1`, { headers: H() });
    if (!r.ok) throw new Error(`Apollo ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    const accounts = d.email_accounts || d.data?.email_accounts || [];
    res.json({
      mailboxes: accounts.map(a => ({
        id: a.id,
        email: a.email,
        set_this_in_railway: `APOLLO_SEND_EMAIL_ACCOUNT_ID=${a.id}`
      }))
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
