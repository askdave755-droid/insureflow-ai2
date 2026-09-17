// Shared Redis client for non-queue state (Vapi concurrency semaphore,
// counters). Separate from Bull's connections so queue blocking commands
// never contend with app-level reads.
const Redis = require('ioredis');
const config = require('../config');

const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 10000
});

redis.on('error', (err) => console.error('❌ Redis (app) error:', err.message));

module.exports = redis;
