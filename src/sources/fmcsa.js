const axios = require('axios');
const config = require('../config');

// ─── FMCSA QCMobile API ───
// Public carrier lookup API: https://mobile.fmcsa.dot.gov/qc/services/carriers
// Auth: webKey query param (FMCSA_API_KEY env). We enrich new leads by matching
// company/name to a registered motor carrier to grab DOT/MC numbers, fleet size
// (power units), driver count, and operating authority status. Phase 2 adds a
// per-DOT detail fetch for operating radius, hazmat flag, and interstate status.
const FMCSA_BASE = 'https://mobile.fmcsa.dot.gov/qc/services/carriers';

let warnedNoKey = false;

// Common city/location words that Google Maps appends to business titles but
// that are NOT part of the FMCSA legal name (e.g. "ContainerPort Group Detroit").
const US_STATE_WORDS = new Set([
  'ALABAMA','ALASKA','ARIZONA','ARKANSAS','CALIFORNIA','COLORADO','CONNECTICUT',
  'DELAWARE','FLORIDA','GEORGIA','HAWAII','IDAHO','ILLINOIS','INDIANA','IOWA',
  'KANSAS','KENTUCKY','LOUISIANA','MAINE','MARYLAND','MASSACHUSETTS','MICHIGAN',
  'MINNESOTA','MISSISSIPPI','MISSOURI','MONTANA','NEBRASKA','NEVADA','HAMPSHIRE',
  'JERSEY','MEXICO','YORK','CAROLINA','DAKOTA','OHIO','OKLAHOMA','OREGON',
  'PENNSYLVANIA','RHODE','TENNESSEE','TEXAS','UTAH','VERMONT','VIRGINIA',
  'WASHINGTON','WISCONSIN','WYOMING'
]);

function normalizeName(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/\b(LLC|INC|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LP|LLP)\b[.,]?/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build lookup candidates: the raw name, then progressively shortened versions
// with trailing words dropped (Google Maps titles often end with the city:
// "ContainerPort Group Detroit" -> "ContainerPort Group"). Min 2 words kept.
function buildNameVariants(raw) {
  const variants = [];
  const seen = new Set();
  const push = (v) => {
    const t = String(v || '').trim();
    if (t.length >= 3 && !seen.has(t.toUpperCase())) {
      seen.add(t.toUpperCase());
      variants.push(t);
    }
  };

  push(raw);

  const words = String(raw || '').trim().split(/\s+/);
  // Drop trailing words one at a time (keep at least 2 words)
  for (let len = words.length - 1; len >= 2; len--) {
    push(words.slice(0, len).join(' '));
  }
  // Also try dropping trailing state/city words explicitly
  while (words.length > 2 && US_STATE_WORDS.has(words[words.length - 1].toUpperCase())) {
    words.pop();
    push(words.join(' '));
  }

  return variants.slice(0, 5); // cap lookups per name
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function extractCarriers(data) {
  if (!data) return [];
  const content = data.content;
  if (!content) return [];
  // Name search returns content.carrier array (or content array); single lookups
  // may return content as an object with a nested .carrier.
  if (Array.isArray(content)) return content;
  if (Array.isArray(content.carrier)) return content.carrier;
  if (content.carrier && typeof content.carrier === 'object') return [content.carrier];
  if (typeof content === 'object') return [content];
  return [];
}

function mapAuthorityStatus(carrier) {
  const allowed = String(carrier.allowedToOperate ?? carrier.allowed_to_operate ?? '').toUpperCase();
  const statusCode = String(carrier.statusCode ?? carrier.status_code ?? '').toUpperCase();
  if (allowed === 'Y') return 'ACTIVE';
  if (allowed === 'N') return 'NOT_AUTHORIZED';
  if (statusCode) {
    if (statusCode.startsWith('A')) return 'ACTIVE';       // e.g. "A" = active/authorized
    if (statusCode.startsWith('I')) return 'INACTIVE';
    if (statusCode.startsWith('N')) return 'NOT_AUTHORIZED';
    return statusCode;
  }
  return null;
}

function mapCarrier(carrier) {
  if (!carrier) return null;
  const dot = carrier.dotNumber ?? carrier.dot_number ?? carrier.usdotNumber;
  if (!dot) return null;
  // MC/MX docket may live in nested docket info; inspect defensively.
  const mc = carrier.mcNumber
    ?? carrier.docketNumber
    ?? carrier.carrierDocketInfo?.mcNumber
    ?? carrier.carrierDocketInfo?.docketNumber
    ?? (Array.isArray(carrier.docketInfo) ? carrier.docketInfo[0]?.mcNumber : null);
  return {
    dotNumber: String(dot),
    mcNumber: mc ? String(mc) : null,
    vehicleCount: toInt(carrier.totalPowerUnits ?? carrier.totalPowerUnit ?? carrier.powerUnits),
    driverCount: toInt(carrier.totalDrivers ?? carrier.totalDriver ?? carrier.drivers),
    authorityStatus: mapAuthorityStatus(carrier)
  };
}

function pickBestMatch(carriers, target, state) {
  const normTarget = normalizeName(target);
  if (!normTarget) return null;

  const stateFiltered = state
    ? carriers.filter(c => String(c.phyState || c.physicalState || '').toUpperCase() === state.toUpperCase())
    : carriers;

  const pool = stateFiltered.length ? stateFiltered : (state ? [] : carriers);
  if (!pool.length) return null;

  const score = (c) => {
    const legal = normalizeName(c.legalName || c.name);
    if (!legal) return 0;
    if (legal === normTarget) return 3;
    if (legal.startsWith(normTarget) || normTarget.startsWith(legal)) return 2;
    if (legal.includes(normTarget) || normTarget.includes(legal)) return 1;
    return 0;
  };

  let best = null, bestScore = 0;
  for (const c of pool) {
    const s = score(c);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return best;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function lookupByName(name, state) {
  const url = `${FMCSA_BASE}/name/${encodeURIComponent(name)}`;
  const res = await axios.get(url, {
    params: { webKey: config.FMCSA_API_KEY, start: 1, size: 25 },
    timeout: 15000
  });
  const carriers = extractCarriers(res.data);
  if (!carriers.length) return null;
  const best = pickBestMatch(carriers, name, state);
  return best ? mapCarrier(best) : null;
}

// ─── Phase 2: per-DOT detail fetch ───
// Grabs operating radius (interstate vs intrastate/local), hazmat flag, and
// cargo description from the carrier detail record. Returns null on failure.
async function fetchCarrierDetail(dotNumber) {
  const res = await axios.get(`${FMCSA_BASE}/${dotNumber}`, {
    params: { webKey: config.FMCSA_API_KEY },
    timeout: 15000
  });
  const carriers = extractCarriers(res.data);
  const c = carriers[0];
  if (!c) return null;

  const opClass = String(
    c.carrierOperation?.operationClassDesc
    ?? c.operationClassDesc
    ?? c.operationClass
    ?? ''
  ).toLowerCase();

  const interstateRaw = String(
    c.carrierOperation?.interstate ?? c.interstate ?? ''
  ).toUpperCase();
  const interstate = opClass.includes('interstate') || interstateRaw === 'Y';

  const operatingRadius = opClass.includes('interstate')
    ? 'interstate'
    : (opClass.includes('intrastate') || opClass.includes('local'))
      ? 'local'
      : (interstate ? 'interstate' : null);

  const cargoRaw = c.cargoCarried ?? c.cargo ?? null;
  const cargoText = JSON.stringify(cargoRaw || '').toLowerCase();
  const hmFlag = String(c.hmFlag ?? c.hazmatFlag ?? '').toUpperCase();
  const hazmat = cargoText.includes('hazard') || cargoText.includes('hazmat') || hmFlag === 'Y';

  let cargoDescription = null;
  if (Array.isArray(cargoRaw) && cargoRaw.length) {
    cargoDescription = cargoRaw
      .map(x => (x && (x.cargoDesc || x.description)) || String(x))
      .join(', ');
  } else if (typeof cargoRaw === 'string' && cargoRaw) {
    cargoDescription = cargoRaw;
  }

  return { operatingRadius, hazmat, interstate, cargoDescription };
}

// Enrich a lead with FMCSA carrier data. Never throws.
// Returns { dotNumber, mcNumber, vehicleCount, driverCount, authorityStatus,
//           operatingRadius?, hazmat?, interstate? } or null.
async function enrichWithFMCSA({ name, company, state, phone }) {
  if (!config.FMCSA_API_KEY) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn('⚠️ FMCSA_API_KEY is not set — FMCSA enrichment disabled');
    }
    return null;
  }

  // Build the full candidate list: company + name, each with shortened variants
  // to handle Google Maps titles that include the city ("X Trucking Detroit").
  const baseNames = [company, name].filter(Boolean);
  const candidates = [];
  const seen = new Set();
  for (const base of baseNames) {
    for (const variant of buildNameVariants(base)) {
      if (!seen.has(variant.toUpperCase())) {
        seen.add(variant.toUpperCase());
        candidates.push(variant);
      }
    }
  }

  if (!candidates.length) return null;

  for (const candidate of candidates) {
    try {
      const result = await lookupByName(candidate, state);
      if (result) {
        if (candidate !== baseNames[0]) {
          console.log(`🛡️ FMCSA matched via shortened name: "${candidate}"`);
        }
        // Phase 2 — merge in radius / hazmat / interstate detail (best-effort)
        try {
          const detail = await fetchCarrierDetail(result.dotNumber);
          if (detail) {
            console.log(`🛡️ FMCSA detail: DOT#${result.dotNumber} radius=${detail.operatingRadius || '?'} hazmat=${detail.hazmat} interstate=${detail.interstate}`);
            return { ...result, ...detail };
          }
        } catch (detailErr) {
          console.warn(`⚠️ FMCSA detail fetch failed for DOT#${result.dotNumber}: ${detailErr.message}`);
        }
        return result;
      }
    } catch (err) {
      const status = err.response?.status;
      if (status && status >= 400 && status < 500 && status !== 404) {
        // non-404 4xx could mean bad webKey / config issue — log loudly
        console.error(`❌ FMCSA API ${status} for "${candidate}" — check FMCSA_API_KEY/config:`,
          JSON.stringify(err.response?.data || err.message).slice(0, 300));
      } else if (!status || status >= 500) {
        console.error(`❌ FMCSA lookup failed for "${candidate}":`, err.message);
      }
      // 404 = no carrier match — expected often, try next variant quietly
    }
    await sleep(300); // rate-limit courtesy between calls
  }

  console.warn(`⚠️ FMCSA: no match for ${baseNames[0]} (tried ${candidates.length} variants)`);
  return null;
}

module.exports = { enrichWithFMCSA, fetchCarrierDetail };
