// ═══════════════════════════════════════════════
// LEAD → ACCOUNT + OPPORTUNITY CONVERSION (Phase 3)
// When a lead qualifies, it becomes a real pipeline entity:
// an Account (the trucking business) and an Opportunity
// at stage QUALIFIED with all Phase 2 scores carried over.
// ═══════════════════════════════════════════════

const prisma = require('../db');
const { audit } = require('./audit');

function priorityFromBand(band) {
  switch (band) {
    case 'HOT': return 'hot';
    case 'GOOD': return 'high';
    case 'NURTURE': return 'normal';
    default: return 'low';
  }
}

// Dedupe order: DOT number (strongest) → phone → fuzzy company+state.
async function findOrCreateAccount(lead) {
  if (lead.dotNumber) {
    const byDot = await prisma.account.findFirst({ where: { dotNumber: lead.dotNumber } });
    if (byDot) return byDot;
  }
  if (lead.phone) {
    const byPhone = await prisma.account.findFirst({ where: { phone: lead.phone } });
    if (byPhone) return byPhone;
  }
  if (lead.company && lead.state) {
    const byName = await prisma.account.findFirst({
      where: { company: { equals: lead.company, mode: 'insensitive' }, state: lead.state }
    });
    if (byName) return byName;
  }

  return prisma.account.create({
    data: {
      company: lead.company || lead.name,
      dotNumber: lead.dotNumber,
      mcNumber: lead.mcNumber,
      authorityStatus: lead.authorityStatus,
      state: lead.state,
      city: lead.city,
      phone: lead.phone,
      email: lead.email,
      contactName: lead.name,
      contactTitle: lead.title,
      vehicleCount: lead.vehicleCount,
      driverCount: lead.driverCount,
      operatingRadius: lead.operatingRadius,
      hazmat: lead.hazmat || false,
      naicsCode: lead.naicsCode,
      industry: lead.industry,
      revenue: lead.revenue,
      employeeCount: lead.employeeCount,
      riskScore: lead.riskScore,
      opportunityScore: lead.opportunityScore
    }
  });
}

// Promote a lead to Account + Opportunity. Idempotent — if the lead was
// already converted, returns the existing account + open opportunity.
async function promoteLead(leadId, actor = 'system') {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  if (lead.status === 'converted' && lead.accountId) {
    const account = await prisma.account.findUnique({ where: { id: lead.accountId } });
    const opportunity = await prisma.opportunity.findFirst({
      where: { leadId: lead.id, stage: { notIn: ['BOUND', 'LOST'] } }
    });
    if (account && opportunity) return { account, opportunity, alreadyConverted: true };
  }

  const account = await findOrCreateAccount(lead);

  const opportunity = await prisma.opportunity.create({
    data: {
      accountId: account.id,
      leadId: lead.id,
      stage: 'QUALIFIED',
      lineOfBusiness: lead.insuranceType || 'commercial_auto',
      xDate: lead.xDate,
      currentCarrier: lead.currentCarrier,
      riskScore: lead.riskScore,
      opportunityScore: lead.opportunityScore,
      priority: priorityFromBand(lead.scoreBand)
    }
  });

  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: 'converted', accountId: account.id }
  });

  await audit({
    actor,
    action: 'convert',
    entityType: 'Lead',
    entityId: lead.id,
    after: { accountId: account.id, opportunityId: opportunity.id, stage: 'QUALIFIED' }
  });

  console.log(`🔄 CONVERTED: ${lead.company || lead.name} → Account ${account.id} + Opportunity ${opportunity.id} (${lead.scoreBand || 'unscored'})`);

  return { account, opportunity, alreadyConverted: false };
}

module.exports = { promoteLead, findOrCreateAccount, priorityFromBand };
