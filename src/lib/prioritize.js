// ─── PROSPECT PRIORITIZATION (Phase 2) ───────────────────────────────
// Turns scores + X-date into a dial-queue decision:
//   priority ('hot'|'high'|'normal'|'low') and queue delay.
// Bull supports job priority (lower number = sooner). We use BOTH:
// delay handles "not yet" (nurture), priority handles "hot first".

function prioritize({ band, xdate, riskScore, opportunityScore }) {
  // Hard pass — don't spend Vapi minutes
  if (band === 'DONT_WASTE_TIME') {
    return { priority: 'low', queueDelay: null, bullPriority: 99, skip: true,
      reason: 'score below threshold — not worth dial minutes' };
  }

  const tier = xdate?.tier;

  // Critical renewal window always jumps the line
  if (tier === 'CRITICAL' || tier === 'STRIKE_ZONE') {
    return { priority: 'hot', queueDelay: 0, bullPriority: 1,
      reason: `X-date ${tier.toLowerCase()} — dial immediately` };
  }

  if (band === 'HOT') {
    return { priority: 'hot', queueDelay: 0, bullPriority: 1,
      reason: `combined score ${Math.round(opportunityScore * 0.6 + riskScore * 0.4)}` };
  }
  if (band === 'GOOD') {
    return { priority: 'high', queueDelay: 0, bullPriority: 5,
      reason: 'solid score — same-day dial, behind HOT' };
  }

  // NURTURE: no X-date or far out — still dial (that's how we discover
  // X-dates), but after today's real prospects.
  return { priority: 'normal', queueDelay: 0, bullPriority: 10,
    reason: tier === 'NURTURE' ? `renews in ${xdate.daysToRenewal}d — log and dial after priority leads` : 'needs discovery call' };
}

module.exports = { prioritize };
