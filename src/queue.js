const Queue = require('bull');
const config = require('./config');

const callQueue = new Queue('vapi-calls', config.REDIS_URL, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: 100,
    removeOnFail: 50
  }
});

const enrichQueue = new Queue('lead-enrichment', config.REDIS_URL);
const followupQueue = new Queue('followups', config.REDIS_URL);

// Event logging
callQueue.on('completed', (job) => {
  console.log(`✅ Call job completed: ${job.id}`);
});

callQueue.on('failed', (job, err) => {
  console.error(`❌ Call job failed: ${job.id}`, err.message);
});

module.exports = { callQueue, enrichQueue, followupQueue };
