/**
 * src/sources/fmcsa-census.js — FMCSA Company Census lead source (FREE).
 *
 * Pulls trucking companies from the FMCSA census via Socrata
 * (dataset az4n-8mr2, data.transportation.gov). Zero Apollo credits.
 *
 * Field realities of az4n-8mr2 (verified against the live dataset + FMCSA
 * documentation — DO NOT regress these):
 *   - dot_number          Number type
 *   - add_date            TEXT, format YYYYMMDD (eight chars) — NOT ISO 8601.
 *                         Lexicographic sort = chronological sort, so
 *                         $order 'add_date DESC' is valid on the text column.
 *   - power_units/truck_units  TEXT — parse digits client-side; never use
 *                         server-side BETWEEN (query.soql.type-mismatch).
 *   - classdef            TEXT — codes ('A' = authorized for hire,
 *                         'C' = private property) OR full descriptions
 *                         ('AUTHORIZED FOR HIRE', 'PRIVATE PROPERTY').
 *                         Accept both.
 *   - phone/cell_phone/email_address  TEXT; ~96% / 43% / 65% filled.
 *   - status_code         'A' = active (NOT proof of operating authority).
 *
 * API realities (verified the hard way):
 *   - Anonymous requests capped at 1,000 rows -> SOCRATA_APP_TOKEN required
 *     (Railway env, sent as X-App-Token header; free from
 *     data.transportation.gov -> Profile -> Developer Settings).
 *   - $app_token URL param is REJECTED on this platform ("Unrecognized
 *     arguments") — header only.
 *   - Column filters as plain params (?phy_state=MI) — avoid $where with
 *     quotes (mobile paste mangling produced 0-row results).
 *
 * Lane: FMCSA_VERTICAL env decides — 'commercial_auto' (default, commercial
 * auto insurance lane) or 'life_fe' (owner-operator life/FE lane). Affects
 * which feeder cap and call flow the leads compete under.
 *
 * Cron: 06:15 UTC daily + boot run 60s after startup (mirrors life-feeder).
 */
const cron = require('node-cron');
const axios = require('axios');
const prisma = require('../db');
const { callQueue } = require('../queue');

const SOCRATA_BASE = 'https://data.transportation.gov/resource/az4n-8mr2.json';
const APP_TOKEN = process.env.SOCRATA_APP_TOKEN;
const PAGE_SIZE = 50000;                       // max per request WITH app token
const DAILY_CAP = parseInt(process.env.FMCSA_CENSUS_DAILY_CAP || process.env.FMCSA_DAILY_CAP || '60', 10);
const HOT_DAYS = parseInt(process.env.FMCSA_CENSUS_HOT_DAYS || '90', 10);
const STATE = (process.env.FMCSA_CENSUS_STATES || process.env.FMCSA_STATE || 'MI').split(',')[0].trim().toUpperCase();
const VERTICAL = process.env.FMCSA_VERTICAL || 'commercial_auto';
const INSURANCE_TYPE = VERTICAL === 'life_fe' ? 'life' : 'commercial_auto';

function normalizePhoneE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const d = digits.length === 10 ? '1' + digits : digits;
  return d.length === 11 && d.startsWith('1') ? '+' + d : null;
}

// power_units is TEXT — parse digits defensively; fall back to truck_units.
function fleetSize(r) {
  const primary = parseInt(String(r.power_units ?? '').replace(/\D/g, ''), 10);
  if (Number.isFinite(primary) && primary > 0) return primary;
  const fallback = parseInt(String(r.truck_units ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(fallback) ? fallback : 0;
}

// Accept classdef as single-letter code OR full description.
// A / AUTHORIZED FOR HIRE -> true
// C / PRIVATE PROPERTY    -> true (private carriers still need commercial auto)
// Passenger, migrant, mail, government -> false.
function classOk(rawCls) {
  const c = String(rawCls || '').trim().toUpperCase();
  if (!c) return false;
  if (c === 'A' || c === 'C') return true;
  if (c.includes('AUTHORIZED FOR HIRE')) return true;
  if (c.includes('PRIVATE') && !c.includes('PASSENGER')) return true;
  return false;
}

// add_date is TEXT 'YYYYMMDD' (verified). Fall back to generic Date parse.
function authorityAgeDays(addDate) {
  const s = String(addDate || '').trim();
  let t = NaN;
  if (/^\d{8}$/.test(s)) {
    t = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)).getTime();
  } else {
    t = new Date(s).getTime();
  }
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

async function fetchPage(offset) {
  const resp = await axios.get(SOCRATA_BASE, {
    params: {
      phy_state: STATE,
      status_code: 'A',
      $limit: PAGE_SIZE,
      $offset: offset,
      $order: 'add_date DESC',   // YYYYMMDD text sorts chronologically
    },
    headers: APP_TOKEN ? { 'X-App-Token': APP_TOKEN } : {},
    timeout: 180000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return Array.isArray(resp.data) ? resp.data : [];
}

async function ingestCensus() {
  if (!APP_TOKEN) {
    console.warn('🚛 FMCSA census: SOCRATA_APP_TOKEN not set — skipping (1,000-row anon cap would truncate)');
    return { skipped: 'no_token' };
  }

  const todayCount = await prisma.lead.count({
    where: { source: 'fmcsa_census', createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
  });
  if (todayCount >= DAILY_CAP) {
    console.log(`🚛 FMCSA census: daily cap reached (${todayCount}/${DAILY_CAP}) — skipping`);
    return { capped: true, todayCount };
  }
  const remaining = DAILY_CAP - todayCount;

  console.log(`🚛 FMCSA census: pulling ${STATE} actives -> lane=${VERTICAL}, cap ${remaining} more today`);

  // Preload existing DOTs + active phones once (in-memory dedupe, cheap).
  const [dotRows, phoneRows] = await Promise.all([
    prisma.lead.findMany({ where: { dotNumber: { not: null } }, select: { dotNumber: true } }),
    prisma.lead.findMany({
      where: { phone: { not: null }, status: { notIn: ['closed', 'compliance_hold'] } },
      select: { phone: true },
    }),
  ]);
  const dotSet = new Set(dotRows.map(r => r.dotNumber));
  const phoneSet = new Set(phoneRows.map(r => r.phone));

  const reject = { class: 0, units: 0, phone: 0, dot: 0, dupe: 0 };
  let sampleLogged = 0;

  const candidates = [];
  let offset = 0, pages = 0, rawTotal = 0;
  for (;;) {
    const rows = await fetchPage(offset);
    pages++;
    rawTotal += rows.length;

    for (const r of rows) {
      // One-time sample dump so future field drift is diagnosable from logs.
      if (sampleLogged < 1) {
        sampleLogged++;
        console.log('🚛 SAMPLE ROW:', JSON.stringify(r).slice(0, 700));
      }
      if (!classOk(r.classdef)) { reject.class++; continue; }
      const units = fleetSize(r);
      if (units < 3 || units > 50) { reject.units++; continue; }
      const phone = normalizePhoneE164(r.cell_phone || r.phone);
      if (!phone) { reject.phone++; continue; }
      const dot = String(r.dot_number ?? '').trim();
      if (!dot) { reject.dot++; continue; }
      if (dotSet.has(dot)) { reject.dupe++; continue; }
      if (phoneSet.has(phone)) { reject.dupe++; continue; }
      candidates.push({
        dot, phone, units,
        name: (r.company_officer_1 || '').trim() || (r.legal_name || 'Carrier').trim(),
        company: (r.dba_name || '').trim() || (r.legal_name || '').trim(),
        email: (r.email_address || '').trim().toLowerCase() || null,
        city: (r.phy_city || '').trim() || null,
        zip: (r.phy_zip || '').trim() || null,
        drivers: parseInt(String(r.total_drivers ?? '').replace(/\D/g, ''), 10) || null,
        mc: r.docket1 ? `${(r.docket1prefix || 'MC')}${String(r.docket1).replace(/\D/g, '')}` : null,
        ageDays: authorityAgeDays(r.add_date),
      });
    }

    if (rows.length < PAGE_SIZE) break;   // short page = end of dataset
    offset += PAGE_SIZE;
  }

  console.log(`🚛 FILTER REJECTS: ${JSON.stringify(reject)} of ${rawTotal} raw`);

  // Newest authority first (hot band leads the dial order); unknown age last.
  candidates.sort((a, b) => (a.ageDays ?? 1e9) - (b.ageDays ?? 1e9));

  let imported = 0, errors = 0;
  const freshIds = [];
  for (const c of candidates) {
    if (imported >= remaining) break;
    const hot = c.ageDays !== null && c.ageDays <= HOT_DAYS;
    try {
      const lead = await prisma.lead.create({
        data: {
          name: c.name,
          company: c.company,
          phone: c.phone,
          email: c.email,
          city: c.city,
          state: STATE,
          industry: 'trucking',
          occupation: 'trucking company',
          occupationPlural: 'trucking companies',
          insuranceType: INSURANCE_TYPE,
          vertical: VERTICAL,
          source: 'fmcsa_census',
          status: 'pending',
          dotNumber: c.dot,
          mcNumber: c.mc,
          vehicleCount: c.units,
          driverCount: c.drivers,
          authorityStatus: hot ? 'new_authority_hot' : 'active',
          scoreBand: hot ? 'hot' : 'standard',
          opportunityScore: hot ? 90 : (c.units >= 5 && c.units <= 25 ? 65 : 55),
          complianceNotes: `FMCSA census: DOT ${c.dot}${c.mc ? ' / MC ' + c.mc : ''}, ${c.units} units` +
            (c.drivers ? `, ${c.drivers} drivers` : '') +
            (c.ageDays !== null ? `, authority ${c.ageDays}d old` : '') +
            (hot ? ' [HOT: new authority]' : ''),
        },
      });
      dotSet.add(c.dot);
      phoneSet.add(c.phone);
      freshIds.push(lead.id);
      imported++;
    } catch (e) {
      errors++;
      console.warn(`🚛 FMCSA row failed (DOT ${c.dot}): ${e.message}`);
    }
  }

  const hotCount = candidates.filter(c => c.ageDays !== null && c.ageDays <= HOT_DAYS).length;
  console.log(`🚛 FMCSA census ${STATE}: +${imported} leads (${Math.min(hotCount, imported)} hot queued of ${hotCount} hot in state) [raw=${rawTotal} pages=${pages} passed=${candidates.length} err=${errors}]`);

  for (let i = 0; i < freshIds.length; i++) {
    await callQueue.add('make-call', { leadId: freshIds[i] },
      { delay: 5000 + i * 12000, priority: 4, jobId: 'fmcsa-' + freshIds[i] });
  }
  if (freshIds.length) console.log(`🚛 FMCSA census: queued ${freshIds.length} for calling`);

  return { imported, errors, queued: freshIds.length, rawTotal };
}

// 06:15 UTC daily + boot run 60s after startup (mirrors life-feeder).
if (process.env.FMCSA_CENSUS_ENABLE !== '0' && process.env.FMCSA_FEED_ENABLE !== '0') {
  cron.schedule('15 6 * * *', () => ingestCensus().catch(e => console.error('🚛 FMCSA census cron:', e.message)));
  setTimeout(() => ingestCensus().catch(e => console.error('🚛 FMCSA census boot run:', e.message)), 60000);
}

module.exports = { ingestCensus };
