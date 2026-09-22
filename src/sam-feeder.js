/**
 * sam-feeder.js — SAM.gov discovery → HasData phone bridge → queue
 * Pulls ACTIVE federal-contractor entities, qualifies by state/NAICS/SBA
 * flags, bridges phone+website via HasData Maps, queues for the dialer.
 * ENV: SAM_API_KEY, HASDATA_API_KEY (set), SAM_DAILY_BUDGET=8
 * CRON: 1x daily 21:00 ET so the queue is warm for the morning window.
 *
 * NOTE (schema adaptation): Lead has no businessName/dba/website/zip/naics[]/
 * lane/tags columns and phone/state are NOT NULL. The entity is mapped to the
 * real columns (name/company/city/state/naicsCode/uei) and dba, website, zip,
 * full NAICS list, lane, SBA flags and POC are kept as JSON in complianceNotes
 * ("[sam] {...}"). Entities with no bridged phone are logged and NOT created.
 */
const prisma = require("./db");
const { callQueue } = require("./queue");
const { formatPhoneE164 } = require("./lib/validate");
const { isSchemaDriftError, driftSummary } = require("./lib/schemaDrift");

const SAM_API = "https://api.sam.gov/entity-information/v3/entities";
const BUDGET = parseInt(process.env.SAM_DAILY_BUDGET || "8", 10);

const STATES = ["MI"];
const NAICS = ["484110","484122","484121","236220","238910",
               "812111","722511","811111"];
const SIZE = 100;
let running = false;

async function getSamCountToday() {
  const today = new Date(); today.setHours(0,0,0,0);
  return prisma.lead.count({ where: { source: "sam", createdAt: { gte: today } } });
}

async function pullSam(state, naics, page) {
  const params = new URLSearchParams({
    api_key: process.env.SAM_API_KEY,
    registrationStatus: "A",
    physicalAddressProvinceOrStateCode: state,
    primaryNaics: naics,
    size: String(SIZE),
    page: String(page),
    includeSections: "entityRegistration,coreData,assertions,pointsOfContact",
  });
  const r = await fetch(`${SAM_API}?${params}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`SAM ${r.status}: ${(await r.text()).slice(0,200)}`);
  return r.json();
}

function qualify(ent) {
  const reg = ent.entityRegistration || {};
  const core = ent.coreData || {};
  const bizTypes = (core.businessTypes?.businessTypeList || core.businessTypeList || [])
    .map(b => b.businessTypeDesc || b.businessType?.desc || b);
  const naicsList = (ent.assertions?.goodsAndServices?.naicsList || ent.assertions?.naicsList || [])
    .map(n => n.naicsCode);
  const pocs = ent.pointsOfContact || {};
  const poc = Array.isArray(pocs)
    ? (pocs.find(p => /government|business/i.test(p.pocType || "")) || {})
    : (pocs.governmentBusinessPOC || {});
  return {
    uei: reg.ueiSAM,
    name: reg.legalBusinessName,
    dba: reg.dbaName || null,
    addr: core.physicalAddress || {},
    structure: core.generalInformation?.entityStructureDesc || core.entityStructureDesc || null,
    naics: naicsList,
    flags: {
      woman: bizTypes.some(t => /woman/i.test(t)),
      veteran: bizTypes.some(t => /veteran/i.test(t)),
      minority: bizTypes.some(t => /minority|black american|hispanic/i.test(t)),
      hubzone: bizTypes.some(t => /hubzone/i.test(t)),
    },
    poc,
  };
}

async function bridgePhone(q) {
  const query = `${q.name} ${q.addr.city || ""} ${q.addr.stateOrProvinceCode || q.addr.stateOrProvince || ""}`;
  const r = await fetch(
    `https://api.hasdata.com/scrape/google-maps/search?query=${encodeURIComponent(query)}`,
    { headers: { "x-api-key": process.env.HASDATA_API_KEY },
      signal: AbortSignal.timeout(60_000) });
  if (!r.ok) return null;
  const d = await r.json();
  const place = (d.places || d.results || d.localResults || [])[0];
  if (!place) return null;
  return { phone: place.phone || place.phoneNumber || null,
           website: place.website || null };
}

async function run() {
  if (running) return console.log("⏭️ SAM feeder: already running");
  if (!process.env.SAM_API_KEY) return console.log("⏭️ SAM feeder: SAM_API_KEY not set");
  running = true;
  try {
    const used = await getSamCountToday();
    if (used >= BUDGET) return console.log(`⏸️ SAM budget done (${used}/${BUDGET})`);
    outer:
    for (const state of STATES) {
      for (const naics of NAICS) {
        if (await getSamCountToday() >= BUDGET) break outer;
        let page = 0;
        while (page < 2) {
          let data;
          try { data = await pullSam(state, naics, page); }
          catch (e) { console.error(`❌ SAM pull ${state}/${naics} p${page}: ${e.message}`); break; }
          const ents = data.entityData || [];
          if (!ents.length) break;
          console.log(`🏛️ SAM ${state} ${naics} p${page}: ${ents.length} active entities`);
          for (const ent of ents) {
            if (await getSamCountToday() >= BUDGET) break outer;
            try {
            const q = qualify(ent);
            if (!q.uei || !q.name) continue;
            const exists = await prisma.lead.findFirst({ where: { uei: q.uei } });
            if (exists) continue;
            const bridge = await bridgePhone(q).catch(() => null);
            const phone = formatPhoneE164(bridge?.phone || "");
            const lane = q.flags.woman || q.flags.veteran ? "PRIORITY" : "COMMERCIAL";
            const tag = q.flags.woman ? " [woman-owned]" : (q.flags.veteran ? " [vet]" : "");
            if (!phone) {
              console.log(`  ✓ ${q.name}${tag} no-phone (skipped — phone required)`);
              continue;
            }
            const dupPhone = await prisma.lead.findFirst({ where: { phone, status: { not: "closed" } } });
            if (dupPhone) {
              await prisma.lead.update({ where: { id: dupPhone.id }, data: { uei: q.uei } }).catch(() => {});
              console.log(`  ↩ ${q.name} phone already in pipeline (${dupPhone.id}) — tagged uei`);
              continue;
            }
            const lead = await prisma.lead.create({ data: {
              uei: q.uei,
              name: q.poc?.firstName ? `${q.poc.firstName} ${q.poc.lastName || ""}`.trim() : q.name,
              company: q.name,
              title: q.poc?.title || null,
              phone,
              email: q.poc?.email || null,
              city: q.addr.city || null,
              state: q.addr.stateOrProvinceCode || q.addr.stateOrProvince || state,
              naicsCode: q.naics[0] || naics,
              industry: q.structure,
              vertical: "commercial_auto", source: "sam", status: "pending",
              complianceNotes: "[sam] " + JSON.stringify({
                dba: q.dba, website: bridge?.website || null, zip: q.addr.zipCode || null,
                naics: q.naics, lane, ...q.flags, poc: q.poc,
              }).slice(0, 1500),
            }});
            console.log(`  ✓ ${q.name}${tag} 📞`);
            await callQueue.add("make-call", { leadId: lead.id },
              { delay: 15_000, attempts: 3, backoff: { type: "exponential", delay: 60_000 },
                priority: lane === "PRIORITY" ? 1 : 5, jobId: "sam-" + lead.id });
            } catch (e) {
              if (isSchemaDriftError(e)) {
                // Schema drift (e.g. leads.uei dropped): log ONCE, abort the
                // whole run — every create would fail the same way.
                console.error(`🚨 SAM feeder ABORTED: DB schema drift (${driftSummary(e)}). Fix the schema before next run — refusing to flood logs.`);
                return;
              }
              console.warn(`⚠️ SAM entity failed (${(ent.entityRegistration || {}).legalBusinessName || 'unknown'}): ${e.message}`);
            }
          }
          page++;
        }
      }
    }
    console.log(`🏛️ SAM feeder complete. Budget: ${await getSamCountToday()}/${BUDGET}`);
  } finally { running = false; }
}

module.exports = { runSamFeeder: run };
if (require.main === module) run().finally(() => prisma.$disconnect());
