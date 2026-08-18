const axios = require('axios');
const config = require('../config');

// ─── FMCSA QCMobile API ───
// Public carrier lookup API: https://mobile.fmcsa.dot.gov/qc/services/carriers
// Auth: webKey query param (FMCSA_API_KEY env). We enrich new leads by matching
// company/name to a registered motor carrier to grab DOT/MC numbers, fleet size
// (power units), driver count, and operating authority status.
const FMCSA_BASE = 'https://mobile.fmcsa.dot.gov/qc/services/carriers';

let warnedNoKey = false;

function normalizeName(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/\b(LLC|INC|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LP|LLP)\b[.,]?/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

// Enrich a lead with FMCSA carrier data. Never throws.
// Returns { dotNumber, mcNumber, vehicleCount, driverCount, authorityStatus } or null.
async function enrichWithFMCSA({ name, company, state, phone }) {
  if (!config.FMCSA_API_KEY) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn('⚠️ FMCSA_API_KEY is not set — FMCSA enrichment disabled');
    }
    return null;
  }

  const candidates = [company, name].filter(Boolean);
  if (!candidates.length) return null;

  for (const candidate of candidates) {
    try {
      const result = await lookupByName(candidate, state);
      if (result) return result;
      console.warn(`⚠️ FMCSA: no match for ${candidate}${state ? ` (${state})` : ''}`);
    } catch (err) {
      const status = err.response?.status;
      if (status && status >= 400 && status < 500) {
        // 404 = no carrier match; other 4xx could mean bad webKey / config issue
        if (status === 404) {
          console.warn(`⚠️ FMCSA: no match for ${candidate} (404)`);
        } else {
          console.error(`❌ FMCSA API ${status} for "${candidate}" — check FMCSA_API_KEY/config:`,
            JSON.stringify(err.response?.data || err.message).slice(0, 300));
        }
      } else {
        console.error(`❌ FMCSA lookup failed for "${candidate}":`, err.message);
      }
    }
    await sleep(300); // rate-limit courtesy between calls
  }

  return null;
}

module.exports = { enrichWithFMCSA };
