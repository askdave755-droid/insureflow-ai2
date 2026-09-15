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
 *     life leads exist, protecting both HasData credits and Vapi spend.
 *
 * Env:
 *   HASDATA_API_KEY    required (feeder no-ops without it)
 *   LIFE_FEED_ENABLE   '0' disables the cron (default on)
 *   LIFE_DAILY_CAP     max life leads per day (default 45 — sized to Vapi concurrency)
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

// Count today's life leads straight from the leads table — no extra table needed.
async function getQueuedToday() {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM leads
     WHERE vertical='life_fe' AND created_at >= CURRENT_DATE`,
    []
  );
  return r.rows[0].n;
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
      // Queue the fresh life leads for calling (240s spacing — sized to Vapi
      // concurrency so we don't hit the concurrent-call limit; business-hours
      // enforced by worker)
      const fresh = await prisma.lead.findMany({
        where: { vertical: 'life_fe', source: 'hasdata_maps', status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: stats.imported,
        select: { id: true }
      });
      for (let i = 0; i < fresh.length; i++) {
        await callQueue.add('make-call', { leadId: fresh[i].id },
          { delay: 5000 + i * 240000, priority: 5, jobId: 'life-' + fresh[i].id });
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
