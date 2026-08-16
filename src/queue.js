const Queue = require('bull');
const config = require('./config');

// Explicit Redis options required for managed Redis (Railway) —
// Bull's blocking commands fail with default ioredis settings.
const redisOpts = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 10000
};

const queueSettings = {
  lockDuration: 30000,
  stalledInterval: 30000,
  guardInterval: 5000,
  retryProcessDelay: 2000
};

const callQueue = new Queue('vapi-calls', config.REDIS_URL, {
  redis: redisOpts,
  settings: queueSettings,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: 100,
    removeOnFail: 50
  }
});

const enrichQueue = new Queue('lead-enrichment', config.REDIS_URL, {
  redis: redisOpts,
  settings: queueSettings
});
const followupQueue = new Queue('followups', config.REDIS_URL, {
  redis: redisOpts,
  settings: queueSettings
});

// Connection state logging
callQueue.on('ready', () => {
  console.log('✅ Bull queue "vapi-calls" connected to Redis and ready');
});

callQueue.on('error', (err) => {
  console.error('❌ Bull queue "vapi-calls" Redis error:', err.message);
});

// Event logging
callQueue.on('completed', (job) => {
  console.log(`✅ Call job completed: ${job.id}`);
});

callQueue.on('failed', (job, err) => {
  console.error(`❌ Call job failed: ${job.id}`, err.message);
});

callQueue.on('active', (job) => {
  console.log(`📞 Call job active: ${job.id} (leadId: ${job.data.leadId})`);
});

module.exports = { callQueue, enrichQueue, followupQueue };
