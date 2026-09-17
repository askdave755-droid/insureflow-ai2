// Vapi concurrency semaphore (Redis-backed).
//
// Why: Bull's `concurrency: N` limits how many make-call jobs the WORKER
// processes at once — it does NOT limit how many Vapi API calls fire when a
// backlog of delayed jobs matures at the same second (e.g. every lead
// rescheduled to "next business hours" wakes up together). Vapi rejects the
// overage with 400 'Over Concurrency Limit' and each rejection used to burn
// the daily cap anyway.
//
// This module tracks in-flight Vapi calls in a Redis set. canDial() gates
// the dial, markDialing() reserves a slot on an ACCEPTED call, markEnded()
// releases it from the webhook when the call ends.
const redis = require('./redis');

const ACTIVE_SET = 'vapi:active_calls';
const LIMIT_KEY = 'vapi:concurrency_limit'; // settable at runtime; default below
const DEFAULT_LIMIT = parseInt(process.env.VAPI_CONCURRENCY_LIMIT || '3', 10);

async function canDial() {
  const limit = parseInt(await redis.get(LIMIT_KEY)) || DEFAULT_LIMIT;
  const active = await redis.scard(ACTIVE_SET);
  return active < limit;
}

async function markDialing(callId) {
  if (!callId) return;
  await redis.sadd(ACTIVE_SET, callId);
  await redis.expire(ACTIVE_SET, 3600); // safety TTL — a missed webhook can't lock us forever
}

async function markEnded(callId) {
  if (!callId) return;
  await redis.srem(ACTIVE_SET, callId);
}

// Observability for /health and debugging
async function activeCount() {
  return redis.scard(ACTIVE_SET);
}

module.exports = { canDial, markDialing, markEnded, activeCount, ACTIVE_SET, LIMIT_KEY };
