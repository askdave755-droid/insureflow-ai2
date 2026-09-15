const axios = require('axios');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const SftpClient = require('ssh2-sftp-client');
const config = require('../config');
const { formatPhoneE164 } = require('../lib/validate');
const prisma = require('../db');

// ─── APOLLO.IO API ───
// Current spec (2025-2026):
//   Search:   POST https://api.apollo.io/api/v1/mixed_people/api_search
//             Auth via 'X-Api-Key' header. Filters: person_titles[], person_locations[],
//             q_keywords, per_page, page. NOTE: search does NOT return emails/phones.
//             q_keywords ANDs every word — keep it to ONE focused term.
//             Response uses last_name_obfuscated, not last_name.
//   Enrich:   POST https://api.apollo.io/api/v1/people/bulk_match (up to 10 per call)
//             Returns emails/phones; reveal_phone_number requires a webhook_url and a
//             paid plan, so we only use synchronously returned data and handle
//             402/403 (plan limits) gracefully.
//
// 2026-09-15 PATCH:
//   1. Pagination — caller passes a page cursor so we stop re-pulling page 1 forever.
//   2. Dedupe BEFORE enrich — search results are filtered against the leads table
//      by name+company BEFORE any paid enrichment credits are spent.
//   3. City-by-city targeting — one location per search with page cycling; caller
//      rotates cities so we get depth (pages 1..N) per city instead of re-reading
//      the same first page of a blended location string.
//   4. Optional targeting overrides (titles/keywords) for non-trucking commercial lines.
//
// 2026-09-15 PATCH 2 (post-upgrade smoke test):
//   5. q_keywords fix — Apollo ANDs every word in q_keywords; a 4-word string like
//      "trucking logistics freight transportation" matched NOTHING. Now sends only
//      the first word.
//   6. last_name fix — api_search returns last_name_obfuscated ("Mo***s"), never
//      last_name. All name construction and bulk_match now use it (asterisks stripped
//      for display, raw form passed to bulk_match for matching).
//   7. Scope fix — debug log referenced `response` outside its try block (crash).
//
// 2026-09-15 PATCH 3 — email-only commercial lane:
//   8. Lead filter now keeps leads with email OR phone (was phone-only, which dropped
//      every Apollo lead since phone reveal isn't enabled on the Basic plan).
//      Email-only leads go to the commercial_drip_v1 Brevo sequence in the orchestrator.
const APOLLO_HEADERS = () => ({
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache',
  'X-Api-Key': config.APOLLO_API_KEY
});

const DEFAULT_TITLES = ['Owner', 'President', 'CEO', 'Fleet Manager', 'Operations Manager'];
const DEFAULT_KEYWORDS = 'trucking';  // single-word: Apollo ANDs multi-word q_keywords, killing results
const MAX_PAGES_PER_CALL = 3;

function logApolloError(context, err) {
  const status = err.response?.status;
  const data = err.response?.data;
  if (status === 402 || status === 403) {
    console.warn(`Apollo plan limit (${context}):`, status, JSON.stringify(data || err.message));
  } else {
    console.error(`Apollo ${context} failed:`, status, JSON.stringify(data || err.message));
  }
}

// Check which candidate people already exist in the leads table — BEFORE spending
// enrichment credits. Matches on phone (any status), or name+company, or email.
// Search results rarely include contact info, so name+company does the heavy lifting.
async function filterExistingPeople(people) {
  if (!people.length) return [];

  // Apollo api_search returns last_name_obfuscated (e.g. "Mo***s"), not last_name.
  // Use it for dedupe display and pass it to bulk_match so enrichment can match.
  const names = people
    .map(p => {
      const ln = (p.last_name || p.last_name_obfuscated || '').replace(/\*+/g, '');
      return `${p.first_name || ''} ${ln}`.trim();
    })
    .filter(Boolean);
  const emails = people.map(p => p.email).filter(Boolean);

  const or = [];
  if (emails.length) or.push({ email: { in: emails } });

  // Pair each name with its own company (not full cross-product)
  const pairs = people
    .map(p => {
      const ln = (p.last_name || p.last_name_obfuscated || '').replace(/\*+/g, '');
      return {
        name: `${p.first_name || ''} ${ln}`.trim(),
        company: p.organization?.name
      };
    })
    .filter(x => x.name && x.company);
  for (const pair of pairs.slice(0, 100)) {
    or.push({ AND: [{ name: pair.name }, { company: pair.company }] });
  }
  // Name-only fallback for people with no company in the result
  const nameOnly = names.filter(n => !pairs.some(x => x.name === n));
  for (const n of nameOnly.slice(0, 100)) {
    or.push({ name: n });
  }

  if (!or.length) return people;

  let existing;
  try {
    existing = await prisma.lead.findMany({
      where: { OR: or },
      select: { name: true, company: true, email: true }
    });
  } catch (err) {
    console.error('Apollo dedupe query failed (continuing without dedupe):', err.message);
    return people;
  }

  const existingEmails = new Set(existing.map(e => e.email).filter(Boolean));
  const existingNameCo = new Set(
    existing.map(e => `${(e.name || '').toLowerCase()}|${(e.company || '').toLowerCase()}`)
  );
  const existingNames = new Set(existing.map(e => (e.name || '').toLowerCase()));

  const fresh = people.filter(p => {
    const ln = (p.last_name || p.last_name_obfuscated || '').replace(/\*+/g, '');
    const nm = `${p.first_name || ''} ${ln}`.trim().toLowerCase();
    const co = (p.organization?.name || '').toLowerCase();
    if (p.email && existingEmails.has(p.email)) return false;
    if (co && existingNameCo.has(`${nm}|${co}`)) return false;
    if (!co && nm && existingNames.has(nm)) return false;
    return true;
  });

  console.log(`Apollo dedupe: ${people.length} found, ${people.length - fresh.length} already in DB, ${fresh.length} fresh`);
  return fresh;
}

async function enrichApolloPeople(people) {
  // Bulk-enrich in batches of 10 to retrieve emails/phones. Skip on plan limits.
  const enriched = new Map();
  for (let i = 0; i < people.length; i += 10) {
    const batch = people.slice(i, i + 10);
    try {
      const res = await axios.post(
        'https://api.apollo.io/api/v1/people/bulk_match',
        {
          details: batch.map(p => ({
            id: p.id,
            first_name: p.first_name,
            last_name: p.last_name || p.last_name_obfuscated || undefined,
            organization_name: p.organization?.name
          }))
        },
        { headers: APOLLO_HEADERS(), timeout: 20000 }
      );
      for (const match of (res.data.matches || [])) {
        if (match && match.id) enriched.set(match.id, match);
      }
    } catch (err) {
      logApolloError('enrichment', err);
      if (err.response?.status === 402 || err.response?.status === 403) break; // plan limit — stop enriching
    }
  }
  return enriched;
}

// Fetch contacts for ONE city, walking pages starting at startPage.
// Returns { leads, nextPage, exhausted } so the caller can persist the cursor.
async function fetchApolloContacts(state, city, limit = 100, opts = {}) {
  if (!config.APOLLO_API_KEY) return { leads: [], nextPage: 1, exhausted: true };

  const titles = (opts.titles && opts.titles.length) ? opts.titles : DEFAULT_TITLES;
  const keywords = opts.keywords || DEFAULT_KEYWORDS;
  const insuranceType = opts.insuranceType || 'commercial_auto';
  const perPage = Math.min(limit, 100);
  let page = Math.max(opts.startPage || 1, 1);
  const maxPage = page + MAX_PAGES_PER_CALL - 1;

  const collected = [];
  let exhausted = false;

  while (page <= maxPage && collected.length < limit) {
    let people;
    let lastTotalEntries = null;
    try {
      // q_keywords: Apollo ANDs every word — a 4-word string kills all results.
      // Use only the first (most specific) word; the title filter does the rest.
      const singleKeyword = (keywords || '').split(/\s+/)[0] || undefined;
      const response = await axios.post(
        'https://api.apollo.io/api/v1/mixed_people/api_search',
        {
          person_titles: titles,
          person_locations: [`${city}, ${state}, US`],
          ...(singleKeyword ? { q_keywords: singleKeyword } : {}),
          per_page: perPage,
          page
        },
        { headers: APOLLO_HEADERS(), timeout: 15000 }
      );
      people = response.data.people || [];
      lastTotalEntries = response.data.total_entries ?? null;
    } catch (error) {
      console.error('Apollo fetch failed:', error.response?.status, JSON.stringify(error.response?.data || error.message));
      break;
    }

    console.log(`Apollo search raw: ${city}, ${state} page ${page} — ${people.length} people, total_entries=${lastTotalEntries}, first has_phone=${people[0]?.has_direct_phone}, first org=${people[0]?.organization?.name}`);
    if (!people.length) {
      console.log(`Apollo search: 0 results for ${city}, ${state} page ${page} — city exhausted`);
      exhausted = true;
      break;
    }

    collected.push(...people);
    if (people.length < perPage) { exhausted = true; break; } // last page
    page++;
  }

  if (!collected.length) {
    return { leads: [], nextPage: page, exhausted };
  }

  // Dedupe BEFORE spending enrichment credits
  const fresh = await filterExistingPeople(collected);
  console.log(`Apollo post-dedupe: ${collected.length} collected -> ${fresh.length} fresh`);

  // Enrich only fresh people to get emails/phones
  const enriched = await enrichApolloPeople(fresh);
  console.log(`Apollo post-enrich: ${fresh.length} fresh -> ${enriched.size} enriched matches`);

  const leads = fresh.map(p => {
    const e = enriched.get(p.id) || {};
    const phone = formatPhoneE164(
      e.phone_numbers?.[0]?.sanitized_number ||
      e.phone_numbers?.[0]?.raw_number ||
      e.organization?.primary_phone?.sanitized_number ||
      e.organization?.phone ||
      p.organization?.primary_phone?.sanitized_number ||
      p.organization?.phone
    );
    return {
      name: `${p.first_name || ''} ${(p.last_name || p.last_name_obfuscated || '').replace(/\*+/g, '') || e.last_name || ''}`.trim(),
      phone,
      email: e.email || p.email,
      company: p.organization?.name || e.organization?.name,
      title: p.title || e.title,
      state,
      city,
      source: 'apollo',
      insuranceType,
      industry: p.organization?.industry || e.organization?.industry
    };
  }).filter(l => {
    // Email-only lane: keep leads with a phone OR an email (Apollo Basic doesn't
    // return phones synchronously — email-only leads go to the commercial drip).
    const keep = !!((l.phone || l.email) && l.name);
    if (!keep) console.log(`Apollo filtered out: name="${l.name}" phone=${l.phone || 'NONE'} email=${l.email || 'NONE'}`);
    return keep;
  });

  const withPhone = leads.filter(l => l.phone).length;
  const emailOnly = leads.filter(l => !l.phone && l.email).length;
  console.log(`Apollo search: ${city}, ${state} — ${collected.length} pulled, ${fresh.length} fresh, ${leads.length} qualified (${withPhone} phone, ${emailOnly} email-only) (pages through ${page - 1}${exhausted ? ', exhausted' : ''})`);
  return { leads, nextPage: page, exhausted };
}

// ─── FMCSA API ───
// NOTE: superseded as a lead SOURCE — FMCSA is now used to ENRICH leads at
// ingestion time (see src/sources/fmcsa.js → enrichWithFMCSA, wired into the
// orchestrator loop and the Phantom webhook). This stub remains for export
// compatibility.
async function fetchFMCSANewFilings(state) {
  console.log('FMCSA source: superseded by FMCSA enrichment (src/sources/fmcsa.js)');
  return [];
}

// ─── leO SFTP AUTO-IMPORT ───
async function fetchLeOFromSFTP() {
  if (!config.LEO_SFTP_HOST) return [];

  const sftp = new SftpClient();
  const leads = [];

  try {
    await sftp.connect({
      host: config.LEO_SFTP_HOST,
      username: config.LEO_SFTP_USER,
      password: config.LEO_SFTP_PASS
    });

    const files = await sftp.list('/exports');
    const csvFiles = files.filter(f => f.name.endsWith('.csv'));

    for (const file of csvFiles) {
      const remotePath = `/exports/${file.name}`;
      const localPath = path.join('/tmp', file.name);
      await sftp.get(remotePath, localPath);

      // Parse CSV
      await new Promise((resolve, reject) => {
        fs.createReadStream(localPath)
          .pipe(csv())
          .on('data', (row) => {
            const phone = formatPhoneE164(row.phone || row.Phone || row.PHONE);
            if (!phone) return;

            leads.push({
              name: `${row.first_name || row.FirstName || ''} ${row.last_name || row.LastName || ''}`.trim(),
              phone,
              email: row.email || row.Email,
              company: row.company || row.CompanyName,
              title: row.title || row.JobTitle,
              state: (row.state || row.State || 'MI').toUpperCase(),
              city: row.city || row.City,
              insuranceType: row.insurance_type || 'commercial_auto',
              source: 'leo',
              xDate: row.x_date || row.renewal_date ? new Date(row.x_date || row.renewal_date) : null,
              currentCarrier: row.current_carrier || row.Carrier,
              workersCompMod: row.wc_mod ? parseFloat(row.wc_mod) : null,
              vehicleCount: row.vehicle_count ? parseInt(row.vehicle_count) : null,
              employeeCount: row.employee_count ? parseInt(row.employee_count) : null,
              revenue: row.revenue ? parseInt(row.revenue) : null,
              naicsCode: row.naics_code || row.naics
            });
          })
          .on('end', resolve)
          .on('error', reject);
      });

      // Archive processed file
      await sftp.rename(remotePath, `/exports/processed/${file.name}`);
      fs.unlinkSync(localPath);
    }

    await sftp.end();
  } catch (error) {
    console.error('leO SFTP failed:', error.message);
  }

  return leads;
}

// ─── PHANTOM BUSTER WEBHOOK BUFFER ───
// This receives webhooks and stores them. The orchestrator picks them up.
async function fetchPhantomResults() {
  // Phantom results are pushed via webhook to /webhook/phantom
  // This function would query a temporary store or return []
  return [];
}

module.exports = {
  fetchApolloContacts,
  filterExistingPeople,
  enrichApolloPeople,
  fetchFMCSANewFilings,
  fetchLeOFromSFTP,
  fetchPhantomResults
};
