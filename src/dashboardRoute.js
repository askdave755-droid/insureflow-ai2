// Phase 5 — dashboard route with CSP relaxed for its inline script.
// Helmet's default CSP (script-src 'self') blocks inline <script>, which
// killed the dashboard's interactivity. This router mounts BEFORE helmet's
// response reaches the client with a scoped, page-only relaxation.
// Usage in server.js: app.use(require('./dashboardRoute')) AFTER routes.
const path = require('path');
const express = require('express');
const router = express.Router();

router.get('/dashboard', (req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
  );
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

module.exports = router;
