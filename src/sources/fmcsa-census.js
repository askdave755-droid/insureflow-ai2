/**
 * src/sources/fmcsa-census.js — FMCSA Company Census lead source (FREE).
 *
 * Pulls Michigan trucking companies from the FMCSA census via Socrata
 * (dataset az4n-8mr2, data.transportation.gov). Zero Apollo credits.
 *
 * Filters (all applied in JS — see DEPLOYMENT NOTES):
 *   - status_code = A (active)          [server-side param]
 *   - phy_state   = MI                  [server-side param]
 *   - classdef    = A or C              [JS]
 *   - power_units = 3..50               [JS — column is TEXT in this dataset]
 *   - must have a dialable phone        [JS]
 *
 * Dedupe: dot_number first, then phone (against existing leads, any vertical).
 * Scoring: authority age from add_date — <=90 days = 'hot' band, sorted
 *          newest-authority-first so fresh carriers get dialed first.
 * Cap: FMCSA_DAILY_CAP env (default 60) leads queued per day.
 * Cron: 06:15 UTC daily + one boot run 60s after startup (mirrors life-feeder).
 *
 * DEPLOYMENT NOTES (hard-won, do not regress):
 *   - power_units is TEXT-typed in az4n-8mr2 — NO server-side BETWEEN/$where
 *     on it (Socrata type-mismatch error). All fleet filtering happens in JS.
 *   - Column filters are PLAIN PARAMS (?phy_state=MI&status_code=A), not $where —
 *     quote-mangling on mobile produced 0-row results with $where.
 *   - SOCRATA_APP_TOKEN (Railway env) is REQUIRED. Anonymous requests are
 *     silently capped at 1,000 rows; the pager would misread that as
 *     end-of-dataset. Token raises the cap to 50,000/request and is sent as
 *     the X-App-Token header. Free: data.transportation.gov → Profile →
 *     Developer Settings → Create App Token.
 *
 * Leads land as: vertical='life_fe' (owner-operator life/FE lane), source=
 * 'fmcsa_census', status='pending', then drip-queued to the call worker at
 * 12s spacing — the Redis concurrency semaphore is the real throttle.
 */
const cron = require('node-cron');
const axios = require('axios');
const prisma = require('../db');
const { callQueue } = require('../queue');

const SOCRATA_BASE = 'https://data.transportation.gov/resource/az4n-8mr2.json';
const APP_TOKEN = process.env.SOCRATA_APP_TOKEN;
const PAGE_SIZE = 50000;             // max per request WITH app token
const DAILY_CAP = parseInt(process.env.FMCSA_DAILY_CAP || '60', 10);
const HOT_DAYS = 90;                 // authority <= 90 days old = hot band
const STATE = process.env.FMCSA_STATE || 'MI';

function normalizePhoneE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const d = digits.length === 10 ? '1' + digits : digits;
  return d.length === 11 && d.startsWith('1') ? '+' + d : null;
}

// power_units is TEXT — parse defensively ('3', '003', '3.0' all seen).
function fleetSize(raw) {
  const n = parseInt(String(raw || '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function authorityAgeDays(addDate) {
  if (!addDate) return null;
  const t = new Date(addDate).getTime();
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
      $order: 'dot_number',
    },
    headers: APP_TOKEN ? { 'X-App-Token': APP_TOKEN } : {},
    timeout: 120000,
  });
  return Array.isArray(resp.data) ? resp.data : [];
}

async function ingestCensus() {
  if (!APP_TOKEN) {
    console.warn('🚛 FMCSA census: SOCRATA_APP_TOKEN not set — skipping (anonymous cap would truncate results)');
    return { skipped: 'no_token' };
  }

  // Daily cap: count census leads created today
  const todayCount = await prisma.lead.count({
    where: { source: 'fmcsa_census', createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
  });
  if (todayCount >= DAILY_CAP) {
    console.log(`🚛 FMCSA census: daily cap reached (${todayCount}/${DAILY_CAP}) — skipping`);
    return { capped: true, todayCount };
  }
  const remaining = DAILY_CAP - todayCount;

  console.log(`🚛 FMCSA census: pulling ${STATE} actives, 3-50 units...`);

  // Page the whole state slice, filter in JS, collect candidates.
  const candidates = [];
  const seen = new Set();
  let offset = 0, pages = 0, rawTotal = 0;
  for (;;) {
    const rows = await fetchPage(offset);
    pages++;
    rawTotal += rows.length;
    for (const r of rows) {
      const cls = String(r.classdef || '').trim().toUpperCase();
      if (cls !== 'A' && cls !== 'C') continue;
      const units = fleetSize(r.power_units);
      if (units < 3 || units > 50) continue;
      const phone = normalizePhoneE164(r.telephone || r.phone);
      if (!phone) continue;
      const dot = String(r.dot_number || '').trim();
      if (!dot) continue;
      const key = dot + '|' + phone;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        dot,
        phone,
        name: (r.legal_name || r.dba_name || 'Carrier').trim(),
        dba: (r.dba_name || '').trim() || null,
        city: (r.phy_city || '').trim() || null,
        state: (r.phy_state || STATE).trim(),
        zip: (r.phy_zip || '').trim() || null,
        units,
        classdef: cls,
        ageDays: authorityAgeDays(r.add_date),
      });
    }
    if (rows.length < PAGE_SIZE) break;  // short page = end of dataset
    offset += PAGE_SIZE;
  }

  // Newest authority first (hot band leads the dial order); unknown age last.
  candidates.sort((a, b) => (a.ageDays ?? 1e9) - (b.ageDays ?? 1e9));

  let imported = 0, dupes = 0, errors = 0;
  const freshIds = [];
  for (const c of candidates) {
    if (imported >= remaining) break;
    try {
      // Dedupe vs DB: DOT number first (unique carrier identity), then phone
      // across all verticals (skip closed/compliance_hold).
      const dotDup = await prisma.lead.findFirst({ where: { dotNumber: c.dot } }).catch(() => null);
      if (dotDup) { dupes++; continue; }
      const phoneDup = await prisma.lead.findFirst({
        where: { phone: c.phone, status: { notIn: ['closed', 'compliance_hold'] } },
      });
      if (phoneDup) { dupes++; continue; }

      const hot = c.ageDays !== null && c.ageDays <= HOT_DAYS;
      const lead = await prisma.lead.create({
        data: {
          name: c.name,
          company: c.dba || c.name,
          phone: c.phone,
          city: c.city,
          state: c.state,
          industry: 'trucking',
          occupation: 'trucking company',
          occupationPlural: 'trucking companies',
          insuranceType: 'life',
          vertical: 'life_fe',
          source: 'fmcsa_census',
          status: 'pending',
          dotNumber: c.dot,
          vehicleCount: c.units,
          authorityStatus: hot ? 'new_authority_hot' : 'active',
          scoreBand: hot ? 'hot' : 'standard',
          complianceNotes: `FMCSA census: DOT ${c.dot}, class ${c.classdef}, ${c.units} units` +
                 (c.ageDays !== null ? `, authority ${c.ageDays}d old` : '') +
                 (hot ? ' [HOT: new authority]' : ''),
        },
      });
      freshIds.push(lead.id);
      imported++;
    } catch (e) {
      errors++;
      console.warn(`🚛 FMCSA row failed (DOT ${c.dot}): ${e.message}`);
    }
  }

  const hotCount = candidates.filter(c => c.ageDays !== null && c.ageDays <= HOT_DAYS).length;
  console.log(`🚛 FMCSA census ${STATE} @0: +${imported} leads (band: hot=${Math.min(hotCount, imported)} of ${hotCount} hot in dataset... newest authority first) ` +
    `[raw=${rawTotal} pages=${pages} filtered=${candidates.length} dupes=${dupes} errors=${errors}]`);

  // Drip-queue for calling: 12s spacing, Redis semaphore is the real throttle.
  for (let i = 0; i < freshIds.length; i++) {
    await callQueue.add('make-call', { leadId: freshIds[i] },
      { delay: 5000 + i * 12000, priority: 5, jobId: 'fmcsa-' + freshIds[i] });
  }
  if (freshIds.length) console.log(`🚛 FMCSA census: queued ${freshIds.length} for calling`);

  return { imported, dupes, errors, queued: freshIds.length, rawTotal };
}

// 06:15 UTC daily + first run 60s after boot (mirrors life-feeder pattern).
if (process.env.FMCSA_FEED_ENABLE !== '0') {
  cron.schedule('15 6 * * *', () => ingestCensus().catch(e => console.error('🚛 FMCSA census cron:', e.message)));
  setTimeout(() => ingestCensus().catch(e => console.error('FMCSA census boot run:', e.message)), 60000);
}

module.exports = { ingestCensus };
