/**
 * lib/hasdata.js - HasData Google Maps scraping for the life_fe vertical.
 *
 * Contract (from routes-life.js):
 *   CITY_COORDS: { 'detroit, mi': '@42.3314,-83.0458,12z', ... }
 *   hasdataMapsSearch(query, ll, start) -> raw HasData response rows
 *   importHasDataRows(rows, pool)     -> { imported, skipped }
 *
 * Rows land in leads with vertical='life_fe', occupation=<query>,
 * source='hasdata_maps', status='pending'. Dedupe on phone.
 */
const axios = require('axios');

const HASDATA_API_KEY = process.env.HASDATA_API_KEY;
const HASDATA_BASE = 'https://api.hasdata.com/apis/google-maps';

// Licensed launch states only (MI, AZ, TN, FL). Key = 'city, st' lowercase.
const CITY_COORDS = {
  // Michigan
  'detroit, mi':       '@42.3314,-83.0458,12z',
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

// Parse 'City, ST' out of a Maps address string.
function parseCityState(address) {
  const m = String(address || '').match(/,\s*([^,]+),\s*([A-Z]{2})\s+\d{5}/i);
  if (!m) return { city: null, state: null };
  return { city: m[1].trim(), state: m[2].toUpperCase() };
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const d = digits.length === 10 ? '1' + digits : digits;
  if (d.length !== 11 || !d.startsWith('1')) return null;
  return '+' + d;
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

// Insert rows into leads (life_fe vertical). Best-effort per row;
// dedupe on phone against any non-closed lead. Never throws mid-loop.
async function importHasDataRows(rows, pool) {
  let imported = 0, skipped = 0;
  for (const row of rows) {
    const phone = normalizePhone(row.phone || row.phoneNumber);
    if (!phone) { skipped++; continue; }

    const name = row.title || row.name || 'Business Owner';
    const { city, state } = parseCityState(row.address || row.fullAddress);

    const dup = await pool.query(
      `SELECT id FROM leads WHERE phone=$1 AND status NOT IN ('closed','compliance_hold') LIMIT 1`,
      [phone]
    );
    if (dup.rows.length) { skipped++; continue; }

    await pool.query(
      `INSERT INTO leads (id, name, phone, company, state, city, industry, occupation,
                          insurance_type, source, status, vertical, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'life', 'hasdata_maps', 'pending', 'life_fe', NOW(), NOW())`,
      [name, phone, name, state, city, row.occupation || row.category || null, row.occupation || null]
    );
    imported++;
  }
  return { imported, skipped };
}

module.exports = { CITY_COORDS, hasdataMapsSearch, importHasDataRows };
