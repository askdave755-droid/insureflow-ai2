const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const routes = require('./routes');
const prisma = require('./db');
const { attachCarrierRoutes } = require('./routes-carrier');
require('./orchestrator');
require('./workers/callWorker');

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

// Static dashboard
app.use(express.static('public'));

// Routes
app.use(routes);

// Carrier routes expect a pg-style pool; shim it over Prisma
// ($queryRawUnsafe supports $1 positional params used by routes-carrier).
const pool = {
  query: async (sql, params) => ({ rows: await prisma.$queryRawUnsafe(sql, ...(params || [])) })
};
attachCarrierRoutes(app, pool);

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = config.PORT;
app.listen(PORT, () => {
  console.log(`🚀 InsureFlowAI 2.0 running on port ${PORT}`);
  console.log(`📊 Health: ${config.BASE_URL}/health`);
  console.log(`⏸️  Pause: ${config.BASE_URL}/admin/pause`);
});
