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

// When REDIS_URL is unset, Bull would connect to 127.0.0.1:6379 by
// DEFAULT — booting Redis connections on a bare `require` (breaking the
// no-Redis import smoke and hanging scripts). Instead export a stub that
// never connects and throws loudly on any use (fail closed, not silent).
function makeStubQueue(name) {
  const err = `Bull queue "${name}" unavailable — REDIS_URL is not configured`;
  console.warn(`⚠️ ${err}. Queue operations will throw until REDIS_URL is set.`);
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return undefined; // not a thenable
      if (prop === 'on' || prop === 'once') return () => {}; // event wiring is a no-op
      return () => { throw new Error(err); };
    }
  });
}

const callQueue = config.REDIS_URL ? new Queue('vapi-calls', config.REDIS_URL, {
  redis: redisOpts,
  settings: queueSettings,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
    // SPEC §6: every make-call job carries jobId `call:${leadId}` for
    // dedupe. Completed jobs must free that jobId immediately or all
    // future retries for the lead would be silently deduped away — so
    // removeOnComplete is `true`, not a retained count. Call history
    // lives in CallLog/audit, not in Bull.
    removeOnComplete: true,
    removeOnFail: 50
  }
}) : makeStubQueue('vapi-calls');

const enrichQueue = config.REDIS_URL ? new Queue('lead-enrichment', config.REDIS_URL, {
  redis: redisOpts,
  settings: queueSettings
}) : makeStubQueue('lead-enrichment');
const followupQueue = config.REDIS_URL ? new Queue('followups', config.REDIS_URL, {
  redis: redisOpts,
  settings: queueSettings
}) : makeStubQueue('followups');

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
