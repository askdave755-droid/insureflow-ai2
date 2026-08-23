// ═══════════════════════════════════════════════
// QUOTE → PROPOSAL → BIND (Phase 4)
// Carrier quote comes back → record it, present it, and on
// acceptance: bind into a Policy + auto-create the Renewal.
// ═══════════════════════════════════════════════

const prisma = require('../db');
const { audit } = require('./audit');
const { walkToStage } = require('./submissions');
const { createTask } = require('./followup');

// Carrier responded with numbers. Submission walks to QUOTED,
// opportunity walks to QUOTED, Dave gets a task to review.
async function recordQuote(submissionId, data, actor = 'system') {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { opportunity: { include: { account: true } } }
  });
  if (!submission) throw new Error(`Submission ${submissionId} not found`);

  await walkToStage('Submission', submissionId, 'QUOTED', actor);
  await prisma.submission.update({
    where: { id: submissionId },
    data: { respondedAt: new Date() }
  });

  const quote = await prisma.quote.create({
    data: {
      submissionId,
      carrier: data.carrier || submission.carrier,
      status: 'RECEIVED',
      premium: data.premium ?? null,
      commissionRate: data.commissionRate ?? null,
      coverageJson: data.coverages || null,
      effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
      expirationDate: data.expirationDate ? new Date(data.expirationDate) : null
    }
  });

  const opp = submission.opportunity;
  if (opp && ['SUBMITTED'].includes(opp.stage)) {
    await walkToStage('Opportunity', opp.id, 'QUOTED', actor);
  }

  const company = opp?.account?.company || 'unknown account';
  await createTask({
    opportunityId: opp?.id || null,
    accountId: opp?.accountId || null,
    type: 'SEND_QUOTE',
    title: `Quote in from ${quote.carrier} for ${company}${quote.premium ? ` — $${quote.premium}` : ''} — review & present`,
    notes: data.notes || null,
    dueAt: new Date(Date.now() + 4 * 3600000),
    priority: 'hot'
  });

  await audit({ actor, action: 'create', entityType: 'Quote', entityId: quote.id, after: { carrier: quote.carrier, premium: quote.premium } });
  console.log(`💰 Quote recorded: ${quote.carrier} $${quote.premium ?? '?'} for ${company}`);

  return quote;
}

// Quote presented to the insured — opportunity moves to PROPOSAL.
async function presentQuote(quoteId, actor = 'system') {
  const quote = await walkToStage('Quote', quoteId, 'PRESENTED', actor);
  const submission = await prisma.submission.findUnique({ where: { id: quote.submissionId } });
  if (submission) {
    const opp = await prisma.opportunity.findUnique({ where: { id: submission.opportunityId } });
    if (opp && opp.stage === 'QUOTED') {
      await walkToStage('Opportunity', opp.id, 'PROPOSAL', actor);
    }
  }
  return quote;
}

// Insured said yes. Quote → ACCEPTED, Opportunity → BOUND, Policy created
// (effective/expiration from the quote), Renewal auto-seeded at expiry,
// plus a bind-paperwork task for Dave.
async function acceptQuote(quoteId, actor = 'system') {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { submission: { include: { opportunity: { include: { account: true } } } } }
  });
  if (!quote) throw new Error(`Quote ${quoteId} not found`);

  await walkToStage('Quote', quoteId, 'ACCEPTED', actor);

  const opp = quote.submission.opportunity;
  const account = opp.account;
  await walkToStage('Opportunity', opp.id, 'BOUND', actor);

  const effectiveDate = quote.effectiveDate || new Date();
  const expirationDate = quote.expirationDate || new Date(effectiveDate.getTime() + 365 * 86400000);

  const policy = await prisma.policy.create({
    data: {
      accountId: opp.accountId,
      quoteId: quote.id,
      carrier: quote.carrier,
      lineOfBusiness: opp.lineOfBusiness || 'commercial_auto',
      status: 'ACTIVE',
      effectiveDate,
      expirationDate,
      premium: quote.premium,
      commissionRate: quote.commissionRate
    }
  });

  // Renewal is seeded the day the policy binds — X-date engine takes it from there
  const renewal = await prisma.renewal.create({
    data: {
      policyId: policy.id,
      accountId: opp.accountId,
      stage: 'NOT_STARTED',
      renewalDate: expirationDate,
      incumbentPremium: quote.premium
    }
  });

  await createTask({
    opportunityId: opp.id,
    accountId: opp.accountId,
    type: 'REVIEW',
    title: `🎉 BOUND: ${account.company} with ${quote.carrier} — bind paperwork, payment, welcome call`,
    dueAt: new Date(Date.now() + 2 * 3600000),
    priority: 'hot'
  });

  await audit({
    actor,
    action: 'bind',
    entityType: 'Policy',
    entityId: policy.id,
    after: { carrier: quote.carrier, premium: quote.premium, effectiveDate, expirationDate, renewalId: renewal.id }
  });

  console.log(`🎉 BOUND: ${account.company} — ${quote.carrier} policy ${policy.id}, renewal seeded ${expirationDate.toISOString().slice(0, 10)}`);

  return { quote: await prisma.quote.findUnique({ where: { id: quoteId } }), policy, renewal };
}

// Quote declined (by insured or carrier withdrawal) — tracked for analytics.
async function declineQuote(quoteId, reason = null, actor = 'system') {
  const quote = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new Error(`Quote ${quoteId} not found`);
  await walkToStage('Quote', quoteId, 'DECLINED', actor);

  // If every quote on the submission is declined, the submission is DECLINED
  const siblings = await prisma.quote.findMany({ where: { submissionId: quote.submissionId } });
  if (siblings.every(q => q.id === quoteId || ['DECLINED', 'EXPIRED'].includes(q.status))) {
    const sub = await prisma.submission.findUnique({ where: { id: quote.submissionId } });
    if (sub && !['DECLINED', 'WITHDRAWN'].includes(sub.status)) {
      try {
        await walkToStage('Submission', sub.id, 'DECLINED', actor);
        await prisma.submission.update({ where: { id: sub.id }, data: { declinedReason: reason } });
      } catch (_) { /* walk may be off-path — leave submission as-is */ }
    }
  }

  await audit({ actor, action: 'update', entityType: 'Quote', entityId: quoteId, after: { status: 'DECLINED', reason } });
  return prisma.quote.findUnique({ where: { id: quoteId } });
}

module.exports = { recordQuote, presentQuote, acceptQuote, declineQuote };
