/**
 * lib/hasdata.js - HasData Google Maps scraping for the life_fe vertical.
 *
 * Contract (from routes-life.js):
 *   CITY_COORDS: { 'detroit, mi': '@42.3314,-83.0458,12z', ... }
 *   hasdataMapsSearch(query, ll, start) -> raw HasData response rows
 *   importHasDataRows(rows, pool)     -> { imported, skipped }
 *
 * Rows land in leads with vertical='life_fe', source='hasdata_maps',
 * status='pending'. Occupation niche comes from lib/occupations.js
 * (Maps categories -> Russell specialty line), falling back to the
 * scrape query. Dedupe order: place_id (unique) -> phone.
 *
 * 2026-09-15 PATCH:
 *   - State guard: skip any row whose parsed state is not a licensed state.
 *     HasData city scrapes drift across borders (Detroit -> Windsor ON gave a
 *     +1-519 number with null state -> 23502 NOT NULL violation). Dropping
 *     unlicensed/foreign rows fixes the crash AND stops non-US lead leakage.
 *   - Per-row try/catch: one bad row logs a warning and is counted as an error,
 *     not allowed to abort the whole batch.
 *   - Address parser now also matches 'City, ST' with no ZIP.
 *
 * 2026-09-17 PATCH 3:
 *   - parseCityState detects Canadian postal codes (N8X 1X1) and returns
 *     'CA-ON'-style markers so the skip log says foreign, not unparsed.
 *   - importHasDataRows logs per-run skip-reason counters.
 *   - Detroit zoom tightened 12z -> 13z to reduce Windsor bleed.
 */
const axios = require('axios');
const { detectOccupation } = require('./occupations');
const config = require('../config');
const { isSchemaDriftError, driftSummary } = require('./schemaDrift');

const HASDATA_API_KEY = process.env.HASDATA_API_KEY;
// Correct API path per docs.hasdata.com: /scrape/google-maps/search
// (old '/apis/google-maps' base returned HTTP 404 from HasData).
const HASDATA_BASE = 'https://api.hasdata.com/scrape/google-maps';

// Licensed launch states only (MI, AZ, TN, FL). Key = 'city, st' lowercase.
const CITY_COORDS = {
  // Michigan
  'detroit, mi':       '@42.3314,-83.0458,13z',
  'grand rapids, mi':  '@42.9634,-85.6681,12z',
  'lansing, mi':       '@42.7325,-84.5555,12z',
  'flint, mi':         '@43.0125,-83.6875,12z',
  'ann arbor, mi':     '@42.2808,-83.7430,12z',
  // Arizona
  'phoenix, az':       '@33.4484,-112.0740,11z',
  'tucson, az':        '@32.2226,-110.9747,11z',
  'mesa, az':          '@33.4152,-111.8315,12z',
  'scottsdale, az':    '@33.4942,-111.9261,12z',
  // Tennessee
  'memphis, tn':       '@35.1495,-90.0490,11z',
  'nashville, tn':     '@36.1627,-86.7816,11z',
  'knoxville, tn':     '@35.9606,-83.9207,12z',
  'chattanooga, tn':   '@35.0456,-85.3097,12z',
  // Florida
  'jacksonville, fl':  '@30.3322,-81.6557,11z',
  'miami, fl':         '@25.7617,-80.1918,11z',
  'tampa, fl':         '@27.9506,-82.4572,11z',
  'orlando, fl':       '@28.5383,-81.3792,11z',
  'fort lauderdale, fl': '@26.1224,-80.1373,12z'
};

// Parse 'City, ST' out of a Maps address string. Handles:
//   "123 Main St, Detroit, MI 48201"  (street, city, ST zip)
//   "Detroit, MI 48201" / "Detroit, MI"  (city, ST [zip])
//   "123 Main St, MI 48201"           (street, ST zip, no city)
function parseCityState(address) {
  const a = String(address || '');
  let m = a.match(/,\s*([^,]+),\s*([A-Z]{2})\s+\d{5}/i);      // street, city, ST zip
  if (m) return { city: m[1].trim(), state: m[2].toUpperCase() };
  m = a.match(/^\s*([^,]+),\s*([A-Z]{2})(?:\s+\d{5})?\s*$/i); // city, ST [zip]
  if (m) return { city: m[1].trim(), state: m[2].toUpperCase() };
  m = a.match(/,\s*([A-Z]{2})\s+\d{5}/);                       // street, ST zip (no city)
  if (m) return { city: null, state: m[1].toUpperCase() };
  // Canadian postal code anywhere in the address -> mark foreign visibly
  if (/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i.test(a)) {
    const prov = a.match(/,\s*([A-Z]{2})\s+[A-Z]\d[A-Z]/i);
    return { city: null, state: 'CA-' + (prov ? prov[1].toUpperCase() : '??') };
  }
  return { city: null, state: null };
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const d = digits.length === 10 ? '1' + digits : digits;
  if (d.length !== 11 || !d.startsWith('1')) return null;
  return '+' + d;
}

// Singularize a niche query for the occupation column:
// "barbershops" -> "barbershop", "roofing contractors" -> "roofing contractor"
function singularize(query) {
  return String(query).trim().replace(/s\b/i, '').replace(/\s+$/,'');
}

async function hasdataMapsSearch(query, ll, start = 0) {
  if (!HASDATA_API_KEY) throw new Error('HASDATA_API_KEY not set');
  const resp = await axios.get(`${HASDATA_BASE}/search`, {
    params: { q: query, ll, start },
    headers: { 'x-api-key': HASDATA_API_KEY },
    timeout: 30000
  });
  const data = resp.data;
  return data?.localResults || data?.results || data?.data || (Array.isArray(data) ? data : []);
}

// Insert rows into leads (life_fe vertical). Best-effort per row — a bad row is
// logged + counted, never aborts the batch.
// Dedupe on place_id first (Google identity), then phone.
async function importHasDataRows(rows, pool, query = null) {
  let imported = 0, skipped = 0, errors = 0;
  const why = { no_phone: 0, foreign: 0, unlicensed_state: 0, duplicate: 0 };
  for (const row of rows) {
    try {
      const placeId = row.placeId || row.place_id || null;
      const phone = normalizePhone(row.phone || row.phoneNumber);
      if (!phone) { skipped++; why.no_phone++; continue; }

      const name = row.title || row.name || 'Business Owner';
      const { city, state } = parseCityState(row.address || row.fullAddress);

      // Licensed-state guard: drops border-drift (Windsor ON etc.) and any row
      // whose state could not be parsed. Prevents the 23502 NOT NULL crash and
      // keeps non-licensed / non-US leads out of the pipeline.
      if (!state || !config.ALLOWED_STATES.includes(state)) {
        skipped++;
        if (state && state.startsWith('CA-')) {
          why.foreign++;
          console.warn(`HasData skip (foreign ${state}): ${name} ${phone}`);
        } else {
          why.unlicensed_state++;
          console.warn(`HasData skip (state "${state || 'unparsed'}" not licensed): ${name} ${phone}`);
        }
        continue;
      }

      const categories = Array.isArray(row.types) ? row.types.join(',')
                       : Array.isArray(row.categories) ? row.categories.join(',')
                       : (row.type || row.category || null);

      // Maps category -> Russell specialty niche (occupation / occupation_plural)
      const occ = detectOccupation(categories, row.description || row.title || '');
      const occupation = occ.singular !== 'business owner' ? occ.singular
                       : (query ? singularize(query) : occ.singular);
      const occupationPlural = occ.singular !== 'business owner' ? occ.plural
                       : (query || occ.plural);

      // Dedupe: place_id first
      if (placeId) {
        const dup = await pool.query(`SELECT id FROM leads WHERE place_id=$1 LIMIT 1`, [placeId]);
        if (dup.rows.length) { skipped++; why.duplicate++; continue; }
      }
      const dup = await pool.query(
        `SELECT id FROM leads WHERE phone=$1 AND status NOT IN ('closed','compliance_hold') LIMIT 1`,
        [phone]
      );
      if (dup.rows.length) { skipped++; why.duplicate++; continue; }

      await pool.query(
        `INSERT INTO leads (id, name, phone, company, state, city, industry, occupation,
                            occupation_plural, categories, place_id,
                            insurance_type, source, status, vertical, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 'life', 'hasdata_maps', 'pending', 'life_fe', NOW(), NOW())`,
        [name, phone, name, state, city, occupation, occupation, occupationPlural, categories, placeId]
      );
      imported++;
    } catch (e) {
      if (isSchemaDriftError(e)) {
        // Schema drift: log ONCE and abort the batch instead of hammering
        // every remaining row into a broken schema.
        console.error(`🚨 HasData import ABORTED: DB schema drift (${driftSummary(e)}). ${imported} imported before abort; refusing to flood logs.`);
        return { imported, skipped, errors, why, aborted: 'schema_drift' };
      }
      errors++;
      console.warn(`HasData row insert failed (${row.title || row.name || 'unknown'}): ${e.message}`);
    }
  }
  console.log(`HasData import: ${imported} imported, ${skipped} skipped ` +
    `(no_phone=${why.no_phone} foreign=${why.foreign} ` +
    `unlicensed=${why.unlicensed_state} dup=${why.duplicate}), ${errors} errors`);
  return { imported, skipped, errors, why };
}

module.exports = { CITY_COORDS, hasdataMapsSearch, importHasDataRows };
