const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const routes = require('./routes');
require('./orchestrator');
require('./workers/callWorker');

const app = express();

// Security
app.use(helmet());
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
