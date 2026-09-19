const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const routes = require('./routes');
const prisma = require('./db');
const pool = require('./lib/pool');
const { attachCarrierRoutes } = require('./routes-carrier');
const { attachLifeRoutes } = require('./routes-life');
const { attachEventRoutes } = require('./routes-events');
const { attachAnnuityRoutes } = require('./routes-annuity');

require('./orchestrator');
require('./life-feeder');   // automated HasData life/FE lead generation
require('./sources/fmcsa-census');  // free FMCSA census trucking leads
require('./workers/callWorker');
require('./lib/sequences');   // registers the sequence-step Bull worker

const app = express();

// Security
// NOTE: script-src allows 'unsafe-inline' because the Agency OS dashboard
// (public/dashboard.html) is a single self-contained page with an inline
// script — helmet's default CSP was blocking it (dead buttons). All other
// helmet protections unchanged.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", "'unsafe-inline'"]
    }
  }
}));
app.use(rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
}));

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static dashboard (+ nexus-chat widget)
// The chat widget (public/nexus-chat.html) is iframed by nexusgpartners.net,
// so for THAT FILE ONLY we relax frame headers: drop X-Frame-Options and
// extend CSP frame-ancestors to the agency site. Every other page keeps
// helmet's full lockdown.
const WIDGET_CSP = "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self' https://nexusgpartners.net https://www.nexusgpartners.net;img-src 'self' data:;object-src 'none';script-src 'self' 'unsafe-inline';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests";
app.use(express.static('public', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('nexus-chat.html')) {
      res.removeHeader('X-Frame-Options');
      res.setHeader('Content-Security-Policy', WIDGET_CSP);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
  }
}));

// Test route to verify router mounting
app.get('/test-router', (req, res) => {
  res.json({ test: true, message: 'If you see this, express app is working' });
});

// Routes
app.use(routes);

// Carrier + Life + Event + Annuity routes expect a pg-style pool (shared shim in lib/pool.js)
attachCarrierRoutes(app, pool);
attachLifeRoutes(app, pool);
attachEventRoutes(app, pool);
attachAnnuityRoutes(app, pool);

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = config.PORT;
app.listen(PORT, () => {
  console.log(`🚀 InsureFlowAI 2.0 running on port ${PORT}`);
  console.log(`📊 Health: ${config.BASE_URL}/health`);
  console.log(`💚 Life:   ${config.BASE_URL}/api/life/stats`);
  console.log(`📈 Annuity: ${config.BASE_URL}/api/annuity/stats`);
  console.log(`⏸️  Pause: ${config.BASE_URL}/admin/pause`);
});
