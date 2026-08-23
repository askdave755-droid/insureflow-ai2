// ═══════════════════════════════════════════════
// AGENCY ANALYTICS (Phase 5)
// One-call dashboard aggregation: funnel, pipeline value,
// revenue + commission, renewals runway, costs, activity.
// ═══════════════════════════════════════════════

const prisma = require('../db');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysFromNow(n) {
  return new Date(Date.now() + n * 86400000);
}

async function safe(query, fallback) {
  try { return await query; } catch (err) {
    console.warn(`⚠️ Analytics subquery failed: ${err.message}`);
    return fallback;
  }
}

async function getDashboard() {
  const today = startOfToday();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  // ─── LEAD FUNNEL ───
  const leadsByStatus = await safe(
    prisma.lead.groupBy({ by: ['status'], _count: true }), []
  );
  const leadsByBand = await safe(
    prisma.lead.groupBy({ by: ['scoreBand'], _count: true, where: { scoreBand: { not: null } } }), []
  );

  // ─── CALL DISPOSITIONS (last 30 days) ───
  const dispositions = await safe(
    prisma.callLog.groupBy({
      by: ['disposition'],
      _count: true,
      where: { disposition: { not: null }, createdAt: { gte: thirtyDaysAgo } }
    }), []
  );

  // ─── PIPELINE ───
  const oppsByStage = await safe(
    prisma.opportunity.groupBy({
      by: ['stage'],
      _count: true,
      _sum: { estimatedPremium: true }
    }), []
  );
  const openOpps = await safe(
    prisma.opportunity.findMany({
      where: { stage: { notIn: ['BOUND', 'LOST'] } },
      orderBy: [{ priority: 'asc' }, { xDate: 'asc' }],
      take: 50,
      include: {
        account: { select: { id: true, company: true, state: true, vehicleCount: true } },
        lead: { select: { id: true, name: true, phone: true, scoreBand: true } }
      }
    }), []
  );

  // ─── TASKS ───
  const openTasks = await safe(
    prisma.task.findMany({
      where: { status: 'open' },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 50,
      include: {
        lead: { select: { id: true, name: true, company: true, phone: true, scoreBand: true } },
        opportunity: { select: { id: true, stage: true, priority: true } }
      }
    }), []
  );
  const overdueCount = await safe(
    prisma.task.count({ where: { status: 'open', dueAt: { lt: new Date() } } }), 0
  );

  // ─── REVENUE ───
  const activePolicies = await safe(
    prisma.policy.findMany({
      where: { status: 'ACTIVE' },
      select: { premium: true, commissionRate: true, carrier: true, expirationDate: true }
    }), []
  );
  const totalPremium = activePolicies.reduce((s, p) => s + (p.premium ? Number(p.premium) : 0), 0);
  const estCommission = activePolicies.reduce((s, p) => {
    if (!p.premium) return s;
    const rate = p.commissionRate ? Number(p.commissionRate) : 12; // default assumption 12%
    return s + Number(p.premium) * (rate / 100);
  }, 0);

  const boundThisMonth = await safe(
    prisma.opportunity.findMany({
      where: { stage: 'BOUND', closedAt: { gte: monthStart } },
      select: { id: true }
    }), []
  );

  const premiumByCarrier = {};
  for (const p of activePolicies) {
    const c = p.carrier || 'Unknown';
    premiumByCarrier[c] = (premiumByCarrier[c] || 0) + (p.premium ? Number(p.premium) : 0);
  }

  // ─── RENEWALS RUNWAY ───
  const renewals = await safe(
    prisma.renewal.findMany({
      where: { renewalDate: { lte: daysFromNow(120) }, stage: { notIn: ['BOUND', 'LOST'] } },
      orderBy: { renewalDate: 'asc' },
      take: 100,
      include: {
        account: { select: { id: true, company: true, state: true } },
        policy: { select: { id: true, carrier: true, premium: true } }
      }
    }), []
  );
  const renewalBuckets = {
    next30: renewals.filter(r => r.renewalDate <= daysFromNow(30)).length,
    next60: renewals.filter(r => r.renewalDate <= daysFromNow(60)).length,
    next90: renewals.filter(r => r.renewalDate <= daysFromNow(90)).length,
    next120: renewals.length
  };
  const renewalPremiumAtRisk = renewals
    .filter(r => r.renewalDate <= daysFromNow(90))
    .reduce((s, r) => s + (r.incumbentPremium ? Number(r.incumbentPremium) : 0), 0);

  // ─── COSTS (last 30 days) ───
  const costs = await safe(
    prisma.cost.groupBy({
      by: ['type'],
      _sum: { amount: true },
      _count: true,
      where: { createdAt: { gte: thirtyDaysAgo } }
    }), []
  );
  const totalCost30d = costs.reduce((s, c) => s + (c._sum.amount ? Number(c._sum.amount) : 0), 0);

  // ─── DAILY ACTIVITY (last 14 days) ───
  const daily = await safe(
    prisma.dailyStat.findMany({
      where: { date: { gte: new Date(today.getTime() - 14 * 86400000) } },
      orderBy: { date: 'asc' }
    }), []
  );

  return {
    generatedAt: new Date().toISOString(),
    funnel: {
      byStatus: Object.fromEntries(leadsByStatus.map(r => [r.status, r._count])),
      byBand: Object.fromEntries(leadsByBand.map(r => [r.scoreBand, r._count]))
    },
    dispositions30d: Object.fromEntries(dispositions.map(r => [r.disposition, r._count])),
    pipeline: {
      byStage: Object.fromEntries(oppsByStage.map(r => [r.stage, { count: r._count, estPremium: r._sum.estimatedPremium || 0 }])),
      open: openOpps
    },
    tasks: { open: openTasks, overdueCount },
    revenue: {
      activePolicies: activePolicies.length,
      totalPremium,
      estCommission: Math.round(estCommission),
      boundThisMonth: boundThisMonth.length,
      premiumByCarrier
    },
    renewals: { buckets: renewalBuckets, premiumAtRisk90d: renewalPremiumAtRisk, upcoming: renewals.slice(0, 25) },
    costs: { last30d: Math.round(totalCost30d * 100) / 100, byType: Object.fromEntries(costs.map(c => [c.type, { total: Number(c._sum.amount || 0), count: c._count }])) },
    daily
  };
}

module.exports = { getDashboard };
