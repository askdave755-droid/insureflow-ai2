const cron = require('node-cron');
const prisma = require('./db');
const { callQueue } = require('./queue');
const { CITY_COORDS, hasdataMapsSearch, importHasDataRows } = require('./lib/hasdata');
const pool = require('./lib/pool');
const config = require('./config');

/**
 * life-feeder.js - Automated life/FE lead generation (HasData Google Maps).
 *
 * Fills the life_fe pipeline on a schedule instead of manual /api/scraper/hasdata/run taps.
 * Each run scrapes ONE niche x ONE city (rotating), paginating within that combo.
 *
 * Credit discipline (mirrors the Apollo dedupe-before-enrich fix):
 *   - Per-combo cursor kept in memory ('niche|city' -> start offset) so each run
 *     continues where that combo left off instead of re-scraping page 1 forever.
 *   - LIFE_DAILY_CAP env (default 45) stops the feeder for the day once that many
 *     life DIALS exist (call_logs joined to life_fe leads), protecting Vapi spend.
 *
 * Env:
 *   HASDATA_API_KEY    required (feeder no-ops without it)
 *   LIFE_FEED_ENABLE   '0' disables the cron (default on)
 *   LIFE_DAILY_CAP     max life dials per day (default 45 — sized to Vapi concurrency)
 */

// FE/life niches that convert for small-business-owner life insurance.
// Each maps to a Russell specialty line via lib/occupations.js.
const NICHES = [
  'barbershops',
  'beauty salons',
  'auto repair shops',
  'restaurants',
  'daycare centers',
  'contractors',
  'landscaping companies',
  'cleaning services',
  'trucking companies',
  'funeral homes'
];

// Cities that have coordinates in lib/hasdata.js (licensed states only).
const CITIES = Object.keys(CITY_COORDS);

const DAILY_CAP = parseInt(process.env.LIFE_DAILY_CAP || '45', 10);

// Count today's DIALS, not lead creations — the hourly Apollo ingestion also
// creates life_fe leads and was burning the 45-dial cap by noon.
// CallLog -> lead relation exists in the Prisma schema (call_logs.lead_id).
async function getQueuedToday() {
  const n = await prisma.callLog.count({
    where: {
      createdAt: { gte: new Date(new Date().setHours(0,0,0,0)) },
      lead: { vertical: 'life_fe' },
    },
  });
  return n;
}

// Simple in-memory cursor per niche|city (survives within a process run).
// On restart we resume from the leads we already have, so re-scraping the top of
// a combo just means place_id dedupe skips them — cheap, no enrichment cost.
const cursors = {};

function nextCombo() {
  const total = NICHES.length * CITIES.length;
  const idx = new Date().getHours() % total;
  const niche = NICHES[idx % NICHES.length];
  const city = CITIES[Math.floor(idx / NICHES.length) % CITIES.length];
  return { niche, city, key: `${niche}|${city}` };
}

async function feedLife() {
  if (!config.HASDATA_API_KEY) return;
  if (process.env.LIFE_FEED_ENABLE === '0') return;

  const queuedToday = await getQueuedToday();
  if (queuedToday >= DAILY_CAP) {
    console.log(`💚 Life feeder: daily cap reached (${queuedToday}/${DAILY_CAP}) — skipping`);
    return;
  }

  const { niche, city, key } = nextCombo();
  const start = cursors[key] || 0;
  console.log(`💚 Life feeder: scraping "${niche}" in ${city} (start=${start})`);

  try {
    const ll = CITY_COORDS[city];
    const rows = await hasdataMapsSearch(niche, ll, start);
    if (!rows || !rows.length) {
      console.log(`💚 Life feeder: 0 results for ${niche}/${city} — resetting combo`);
      cursors[key] = 0;
      return;
    }

    const stats = await importHasDataRows(rows, pool, niche);
    console.log(`💚 Life feeder: ${niche}/${city} -> ${stats.imported} imported, ${stats.skipped} skipped`);

    // Advance cursor; HasData paginates by result offset, so step by rows received
    cursors[key] = start + rows.length;

    if (stats.imported > 0) {
      // Queue the fresh life leads for calling (12s drip — the Redis
      // concurrency semaphore in the worker is now the real throttle, so we
      // feed steadily instead of spacing wide; business-hours enforced by worker)
      const fresh = await prisma.lead.findMany({
        where: { vertical: 'life_fe', source: 'hasdata_maps', status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: stats.imported,
        select: { id: true }
      });
      for (let i = 0; i < fresh.length; i++) {
        await callQueue.add('make-call', { leadId: fresh[i].id },
          { delay: 5000 + i * 12000, priority: 5, jobId: 'life-' + fresh[i].id });
      }
      console.log(`💚 Life feeder: queued ${fresh.length} life leads for calling`);
    }
  } catch (err) {
    console.error(`💚 Life feeder failed (${niche}/${city}):`, err.response?.status, err.message);
  }
}

// Run at :30 past each hour (offset from the commercial Apollo pull at :00)
if (process.env.LIFE_FEED_ENABLE !== '0') {
  cron.schedule('30 * * * *', feedLife);
  // First run shortly after boot
  setTimeout(feedLife, 30000);
}

module.exports = { feedLife };
