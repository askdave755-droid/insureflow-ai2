const cron = require('node-cron');
const prisma = require('./db');
const { callQueue } = require('./queue');
const { fetchApolloContacts, fetchLeOFromSFTP } = require('./sources');
const { enrichWithFMCSA } = require('./sources/fmcsa');
const { isBusinessHours, getNextBusinessTime } = require('./lib/validate');
const { runIntelligence, summarize } = require('./lib/intel');
const config = require('./config');

// Licensed states only (MI resident; AZ/TN/FL active non-resident).
// TX/GA/OH/IN removed — licenses expired/unverified as of Aug 2026.
//
// 2026-09-15 PATCH — deeper commercial coverage:
//   - Expanded from 8 to 16 markets across the 4 licensed states.
//   - Per-city Apollo page cursors (in-memory) so each hourly pull walks deeper
//     into a city's results instead of re-reading page 1 forever.
//   - Two cities pulled per run (rotating) instead of one — roughly 2x throughput.
//   - Per-city targeting profiles: trucking hubs keep the trucking query; other
//     metros query the niche commercial lines from nexusgpartners.net (contractors,
//     restaurants, childcare, home health, auto repair, etc.).
//
// 2026-09-15 PATCH 2 — email-only lane (reverted to stable version):
//   The email-only drip enroll is commented out pending a boot-crash fix.
//   Apollo leads with phones still queue for calls. Email-only leads are
//   stored in the DB but not yet enrolled in the drip — next patch.
const SOURCES = [
  // ── Michigan (resident) ──
  { state: 'MI', city: 'Detroit',        keywords: 'trucking logistics freight transportation manufacturing', titles: ['Owner', 'President', 'CEO', 'Fleet Manager', 'Operations Manager'] },
  { state: 'MI', city: 'Grand Rapids',   keywords: 'manufacturing contractor construction wholesale',       titles: ['Owner', 'President', 'CEO', 'Operations Manager'] },
  { state: 'MI', city: 'Lansing',        keywords: 'contractor construction restaurant retail services',    titles: ['Owner', 'President', 'CEO'] },
  { state: 'MI', city: 'Flint',          keywords: 'contractor auto repair trucking services',              titles: ['Owner', 'President', 'CEO'] },
  // ── Tennessee ──
  { state: 'TN', city: 'Memphis',        keywords: 'trucking logistics freight warehouse distribution',     titles: ['Owner', 'President', 'CEO', 'Fleet Manager', 'Operations Manager'] },
  { state: 'TN', city: 'Nashville',      keywords: 'contractor construction restaurant hospitality',        titles: ['Owner', 'President', 'CEO', 'Operations Manager'] },
  { state: 'TN', city: 'Knoxville',      keywords: 'contractor construction trucking services',             titles: ['Owner', 'President', 'CEO'] },
  { state: 'TN', city: 'Chattanooga',    keywords: 'trucking logistics manufacturing contractor',           titles: ['Owner', 'President', 'CEO', 'Operations Manager'] },
  // ── Arizona ──
  { state: 'AZ', city: 'Phoenix',        keywords: 'contractor construction trucking landscaping',          titles: ['Owner', 'President', 'CEO', 'Operations Manager'] },
  { state: 'AZ', city: 'Tucson',         keywords: 'contractor construction restaurant services',           titles: ['Owner', 'President', 'CEO'] },
  { state: 'AZ', city: 'Mesa',           keywords: 'contractor construction auto repair retail',            titles: ['Owner', 'President', 'CEO'] },
  { state: 'AZ', city: 'Scottsdale',     keywords: 'restaurant hospitality retail services',                titles: ['Owner', 'President', 'CEO'] },
  // ── Florida ──
  { state: 'FL', city: 'Jacksonville',   keywords: 'trucking logistics freight port contractor',            titles: ['Owner', 'President', 'CEO', 'Fleet Manager', 'Operations Manager'] },
  { state: 'FL', city: 'Miami',          keywords: 'trucking logistics freight import export',              titles: ['Owner', 'President', 'CEO', 'Fleet Manager', 'Operations Manager'] },
  { state: 'FL', city: 'Tampa',          keywords: 'contractor construction restaurant trucking',           titles: ['Owner', 'President', 'CEO', 'Operations Manager'] },
  { state: 'FL', city: 'Orlando',        keywords: 'restaurant hospitality contractor services',            titles: ['Owner', 'President', 'CEO'] },
];

// In-memory per-city Apollo page cursors ("city,state" -> next page to pull).
// Resets on redeploy/restart, which just means a city re-scans from page 1 —
// acceptable because dedupe now happens BEFORE paid enrichment, so re-scanning
// costs zero credits.
const apolloCursors = {};

function nextSources(n) {
  // Rotate through SOURCES, n cities per run, advancing by n each hour.
  const base = (new Date().getHours() * n) % SOURCES.length;
  const picked = [];
  for (let i = 0; i < n; i++) {
    picked.push(SOURCES[(base + i) % SOURCES.length]);
  }
  return picked;
}

async function ingestAndQueue() {
  console.log('🔄 Running lead ingestion...');

  const allLeads = [];

  // Pull from Apollo — 2 cities per run, each walking its own page cursor
  if (config.APOLLO_API_KEY) {
    for (const source of nextSources(2)) {
      const key = `${source.city},${source.state}`;
      const startPage = apolloCursors[key] || 1;
      console.log(`🌆 Apollo pull: ${source.city}, ${source.state} (from page ${startPage})`);
      try {
        const result = await fetchApolloContacts(source.state, source.city, 50, {
          startPage,
          titles: source.titles,
          keywords: source.keywords,
          insuranceType: 'commercial_auto'
        });
        allLeads.push(...result.leads);
        apolloCursors[key] = result.exhausted ? 1 : result.nextPage; // loop city when exhausted
      } catch (error) {
        console.warn(`⚠️ Apollo pull failed for ${key}: ${error.message}`);
      }
    }
  }

  if (config.LEO_SFTP_HOST) {
    const leo = await fetchLeOFromSFTP();
    allLeads.push(...leo);
  }

  console.log(`📥 Ingested ${allLeads.length} leads`);

  let queued = 0;

  for (const leadData of allLeads) {
    try {
      // Dedupe: skip if phone or email already exists
      const orConditions = [];
      if (leadData.phone) orConditions.push({ phone: leadData.phone, status: { not: 'closed' } });
      if (leadData.email) orConditions.push({ email: leadData.email, status: { not: 'closed' } });
      if (orConditions.length) {
        const existing = await prisma.lead.findFirst({ where: { OR: orConditions } });
        if (existing) continue;
      }

      // Validate state
      if (!config.ALLOWED_STATES.includes(leadData.state)) continue;

      // Must have at least one contact path
      if (!leadData.phone && !leadData.email) continue;

      const lead = await prisma.lead.create({
        data: {
          ...leadData,
          phone: leadData.phone || '',
          status: leadData.phone ? 'pending' : 'drip'
        }
      });

      // FMCSA enrichment — best-effort, never blocks queueing
      try {
        const fmcsa = await enrichWithFMCSA({
          name: lead.name,
          company: lead.company,
          state: lead.state,
          phone: lead.phone
        });
        if (fmcsa) {
          await prisma.lead.update({ where: { id: lead.id }, data: fmcsa });
          Object.assign(lead, fmcsa);
          console.log(`🛡️ FMCSA enriched: ${lead.company || lead.name} DOT#${fmcsa.dotNumber} ${fmcsa.authorityStatus || ''}`.trim());
        }
      } catch (err) {
        console.warn(`⚠️ FMCSA enrichment failed for lead ${lead.id}: ${err.message}`);
      }

      // Phase 2 — score, tier, prioritize
      const intel = runIntelligence(lead);
      await prisma.lead.update({ where: { id: lead.id }, data: intel.updates });
      console.log(summarize(lead, intel));

      if (intel.queue.skip) {
        await prisma.lead.update({ where: { id: lead.id }, data: { status: 'nurture' } });
        continue;
      }

      if (lead.phone) {
        // Has a dialable number — call path
        const delay = isBusinessHours(lead.state)
          ? 5000
          : getNextBusinessTime(lead.state) - Date.now();

        await callQueue.add('make-call', { leadId: lead.id }, {
          delay: Math.max(delay, 0),
          priority: intel.queue.bullPriority
        });
        queued++;
      } else if (lead.email) {
        // Email-only — store for drip (enrollment coming in next patch)
        console.log(`📧 Email-only lead stored: ${lead.name} <${lead.email}> (${lead.company || 'no company'})`);
        queued++;
      }
    } catch (leadErr) {
      console.error(`❌ Failed to process lead ${leadData.name || 'unknown'}:`, leadErr.message);
    }
  }

  // Update daily stats
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  await prisma.dailyStat.upsert({
    where: { date: today },
    update: { leadsIngested: { increment: queued } },
    create: { date: today, leadsIngested: queued }
  });

  console.log(`✅ Queued/stored ${queued} leads`);
}

// Run every hour
cron.schedule('0 * * * *', ingestAndQueue);

// Also run on startup
setTimeout(ingestAndQueue, 5000);

module.exports = { ingestAndQueue };
