// ═══════════════════════════════════════════════
// SUBMISSION BUILDER (Phase 4)
// Turns an Opportunity into carrier-ready submissions:
// ACORD-style package JSON + appetite matching + stage walking.
// ═══════════════════════════════════════════════

const prisma = require('../db');
const { audit } = require('./audit');
const { assertTransition } = require('./pipeline');
const { matchCarriers } = require('./carriers');

const MODELS = {
  Opportunity: 'opportunity',
  Submission: 'submission',
  Quote: 'quote',
  Policy: 'policy',
  Renewal: 'renewal'
};

const STAGE_FIELD = { Opportunity: 'stage' };

// Linear happy-paths used for multi-step walks.
const PATHS = {
  Opportunity: ['NEW', 'QUALIFIED', 'RISK_PROFILED', 'SUBMITTED', 'QUOTED', 'PROPOSAL', 'BIND_PENDING', 'BOUND'],
  Submission: ['DRAFT', 'READY', 'SUBMITTED', 'UNDER_REVIEW', 'QUOTED'],
  Quote: ['RECEIVED', 'PRESENTED', 'ACCEPTED']
};

// Walk a record to a target stage/status one legal step at a time.
// Every hop goes through assertTransition — no silent jumps.
async function walkToStage(entityType, id, target, actor = 'system') {
  const model = prisma[MODELS[entityType]];
  const field = STAGE_FIELD[entityType] || 'status';
  const path = PATHS[entityType];

  let rec = await model.findUnique({ where: { id } });
  if (!rec) throw new Error(`${entityType} ${id} not found`);
  let current = rec[field];

  if (current === target) return rec;

  const startIdx = path ? path.indexOf(current) : -1;
  const targetIdx = path ? path.indexOf(target) : -1;

  if (startIdx !== -1 && targetIdx !== -1 && targetIdx > startIdx) {
    for (let i = startIdx + 1; i <= targetIdx; i++) {
      assertTransition(entityType, current, path[i]);
      rec = await model.update({ where: { id }, data: { [field]: path[i] } });
      current = path[i];
    }
  } else {
    // Off-path move — must still be a legal single transition
    assertTransition(entityType, current, target);
    rec = await model.update({ where: { id }, data: { [field]: target } });
  }

  await audit({
    actor,
    action: 'stage_change',
    entityType,
    entityId: id,
    after: { [field]: target }
  });

  return rec;
}

// ─── ACORD-STYLE PACKAGE ───
// Frozen snapshot of the risk exactly as it goes to the carrier.
// Mirrors the data sections of ACORD 125 (applicant), 127/137 (auto/fleet).
function buildAcordPackage(account, opportunity) {
  return {
    formBasis: 'ACORD 125 / 127 / 137 equivalent (JSON)',
    generatedAt: new Date().toISOString(),
    applicant: {
      legalName: account.company,
      dba: account.dba || null,
      address: account.address || null,
      city: account.city || null,
      state: account.state,
      county: account.county || null,
      phone: account.phone || null,
      email: account.email || null,
      contactName: account.contactName || null,
      contactTitle: account.contactTitle || null,
      naicsCode: account.naicsCode || null,
      industry: account.industry || null
    },
    fmcsa: {
      dotNumber: account.dotNumber || null,
      mcNumber: account.mcNumber || null,
      authorityStatus: account.authorityStatus || null,
      operatingRadius: account.operatingRadius || null,
      hazmat: account.hazmat || false
    },
    operations: {
      vehicleCount: account.vehicleCount || null,
      driverCount: account.driverCount || null,
      commodities: account.commodities || null,
      operatingRadius: account.operatingRadius || null
    },
    insurance: {
      lineOfBusiness: opportunity.lineOfBusiness || 'commercial_auto',
      currentCarrier: opportunity.currentCarrier || null,
      xDate: opportunity.xDate || null,
      requestedCoverages: ['auto_liability', 'physical_damage', 'motor_truck_cargo'],
      requestedLimits: { autoLiabilityCsl: 1000000 }
    },
    lossHistory: {
      available: false,
      note: 'Loss runs to be requested from insured / incumbent carrier'
    },
    scores: {
      riskScore: opportunity.riskScore ?? account.riskScore ?? null,
      opportunityScore: opportunity.opportunityScore ?? account.opportunityScore ?? null
    }
  };
}

// Run appetite matching for an opportunity and create DRAFT submissions
// for the top matches (default 3). opts.carriers (array of names) forces
// a specific carrier list instead of auto-matching.
async function createSubmissions(opportunityId, opts = {}, actor = 'system') {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: { account: true, lead: true }
  });
  if (!opportunity) throw new Error(`Opportunity ${opportunityId} not found`);
  if (!opportunity.account) throw new Error('Opportunity has no account attached');

  const account = opportunity.account;
  const pkg = buildAcordPackage(account, opportunity);

  let carrierPicks;
  if (Array.isArray(opts.carriers) && opts.carriers.length) {
    carrierPicks = opts.carriers.map(name => ({ carrier_name: name, match_reasons: ['manual pick'], access_status: 'unknown' }));
  } else {
    const result = matchCarriers({
      state: account.state,
      vertical: 'trucking',
      vehicle_count: account.vehicleCount || 1,
      has_hazmat: account.hazmat || false,
      revenue: account.revenue || 0
    });
    if (!result.all_matches.length) {
      throw new Error(`No carrier appetite match for ${account.company} (${account.state}, ${account.vehicleCount || '?'} units${account.hazmat ? ', hazmat' : ''})`);
    }
    carrierPicks = result.all_matches.slice(0, opts.count || 3);
  }

  const submissions = [];
  for (const pick of carrierPicks) {
    const sub = await prisma.submission.create({
      data: {
        opportunityId,
        carrier: pick.carrier_name,
        status: 'DRAFT',
        packageJson: pkg,
        appetiteMatch: {
          reasons: pick.match_reasons || [],
          accessStatus: pick.access_status || null,
          instantBind: pick.instant_bind || false,
          quoteTurnaroundHours: pick.quote_turnaround_hours ?? null,
          premiumRange: (pick.premium_range_min && pick.premium_range_max)
            ? { min: pick.premium_range_min, max: pick.premium_range_max }
            : null,
          notes: pick.notes || null
        }
      }
    });
    submissions.push(sub);
  }

  await audit({
    actor,
    action: 'create',
    entityType: 'Submission',
    entityId: opportunityId,
    after: { carriers: carrierPicks.map(c => c.carrier_name), count: submissions.length }
  });

  console.log(`📦 Built ${submissions.length} submissions for ${account.company}: ${carrierPicks.map(c => c.carrier_name).join(', ')}`);

  return { submissions, packageJson: pkg };
}

// Mark a DRAFT submission as sent to the carrier. Advances the parent
// opportunity to SUBMITTED once the first submission goes out.
async function submitSubmission(submissionId, actor = 'system') {
  const sub = await walkToStage('Submission', submissionId, 'SUBMITTED', actor);
  await prisma.submission.update({
    where: { id: submissionId },
    data: { submittedAt: new Date() }
  });

  const opp = await prisma.opportunity.findUnique({ where: { id: sub.opportunityId } });
  if (opp && ['NEW', 'QUALIFIED', 'RISK_PROFILED'].includes(opp.stage)) {
    await walkToStage('Opportunity', opp.id, 'SUBMITTED', actor);
  }

  console.log(`📤 Submission ${submissionId} (${sub.carrier}) marked SUBMITTED`);
  return prisma.submission.findUnique({ where: { id: submissionId } });
}

module.exports = { buildAcordPackage, createSubmissions, submitSubmission, walkToStage };
