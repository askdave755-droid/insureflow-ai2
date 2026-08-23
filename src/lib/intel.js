// ─── TRANSPORTATION INTELLIGENCE PIPELINE (Phase 2) ──────────────────
// One function that runs the full Phase 2 stack on a lead:
//
//   FMCSA detail → X-date analysis → dual scoring → prioritization
//
// Returns { updates, xdate, scores, queue } — caller persists `updates`
// and uses `queue` (bullPriority / skip) when adding to the call queue.

const { analyzeXDate } = require('./xdate');
const { scoreLead } = require('./scoring');
const { prioritize } = require('./prioritize');

function runIntelligence(lead) {
  // 1. X-date intelligence
  const xdate = analyzeXDate(lead.xDate);

  // 2. Dual scoring (risk = underwriting fit, opportunity = sales value)
  const scores = scoreLead(lead, xdate);

  // 3. Prioritization → queue decision
  const queue = prioritize({
    band: scores.band,
    xdate,
    riskScore: scores.riskScore,
    opportunityScore: scores.opportunityScore
  });

  const updates = {
    riskScore: scores.riskScore,
    opportunityScore: scores.opportunityScore,
    scoreBand: scores.band,
    xdateTier: xdate.tier
  };

  return { updates, xdate, scores, queue };
}

// Log-friendly one-liner
function summarize(lead, result) {
  const s = result.scores;
  return `🎯 ${lead.company || lead.name}: ${s.band} (opp ${s.opportunityScore}/risk ${s.riskScore}) | X-date ${result.xdate.tier}${result.xdate.daysToRenewal != null ? ` ${result.xdate.daysToRenewal}d` : ''} | ${result.queue.reason}`;
}

module.exports = { runIntelligence, summarize };
