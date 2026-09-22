/**
 * src/lib/schemaDrift.js — schema-drift detector for feeder circuit breakers.
 *
 * Background: leads.uei has been dropped twice overnight (2026-09-19 and
 * 2026-09-22) by an out-of-band `prisma db push` from a stale checkout.
 * While the column is missing, EVERY prisma.lead.create() fails with P2022
 * (Prisma always INSERTs every model column), so a feeder will happily burn
 * thousands of rows into the logs (Railway dropped 5,000+ messages) and
 * waste the census/scrape budget. Feeders check this on every row failure:
 * log ONCE, abort the batch.
 *
 * Codes covered:
 *   P2021  Prisma: table does not exist in the current database
 *   P2022  Prisma: column does not exist in the current database
 *   42703  Postgres: undefined_column   (raw SQL path — lib/pool.js)
 *   42P01  Postgres: undefined_table    (raw SQL path)
 *   P2010  Prisma raw-query wrapper (real pg code lives in e.meta.code)
 */
function isSchemaDriftError(e) {
  if (!e) return false;
  const code = e.code || (e.meta && e.meta.code);
  if (code === 'P2021' || code === 'P2022' || code === '42703' || code === '42P01') return true;
  if (e.code === 'P2010' && /does not exist/i.test(String(e.message))) return true;
  return /column .* does not exist|relation .* does not exist/i.test(String(e.message || ''));
}

function driftSummary(e) {
  const code = (e && (e.code || (e.meta && e.meta.code))) || 'unknown';
  const msg = String((e && e.message) || '').split('\n')[0].slice(0, 200);
  return `${code}: ${msg}`;
}

module.exports = { isSchemaDriftError, driftSummary };
