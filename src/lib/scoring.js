// ─── TRANSPORTATION SCORING ENGINES (Phase 2) ────────────────────────
// Two scores, one verdict:
//
//   Transportation Risk Score (0-100)  — underwriting fit: is this a risk
//     our carriers will actually write? (authority, fleet, radius, hazmat)
//
//   Insurance Opportunity Score (0-100) — sales opportunity: is there money
//     and urgency here? (X-date, premium size, shopping signals, contactability)
//
// Combined → scoreBand: HOT / GOOD / NURTURE / DONT_WASTE_TIME
// Every score returns a transparent breakdown so Dave can see WHY.

// ─── TRANSPORTATION RISK SCORE ───
// Higher = better underwriting fit (easier to place with our markets).
function transportationRiskScore(lead) {
  const breakdown = {};
  let score = 0;

  // Authority (35 pts) — the #1 carrier gate
  const auth = (lead.authorityStatus || '').toUpperCase();
  if (auth === 'ACTIVE') { score += 35; breakdown.authority = [35, 'active authority']; }
  else if (auth === 'INACTIVE') { score += 10; breakdown.authority = [10, 'inactive authority — reinstatement conversation']; }
  else if (auth === 'NOT_AUTHORIZED') { breakdown.authority = [0, 'not authorized — carriers decline']; }
  else { score += 15; breakdown.authority = [15, 'authority unknown']; }

  // Fleet size (25 pts) — sweet spot is 2-25 units (Cover Whale/Nirvana appetite)
  const units = lead.vehicleCount;
  if (units == null) { score += 8; breakdown.fleet = [8, 'fleet unknown']; }
  else if (units >= 2 && units <= 25) { score += 25; breakdown.fleet = [25, `${units} units — carrier sweet spot`]; }
  else if (units === 1) { score += 15; breakdown.fleet = [15, 'single unit — owner-op markets only']; }
  else if (units <= 50) { score += 20; breakdown.fleet = [20, `${units} units — mid-market`]; }
  else { score += 5; breakdown.fleet = [5, `${units} units — above our appetite`]; }

  // Operating radius (15 pts) — local/regional easier than long-haul
  const radius = (lead.operatingRadius || '').toLowerCase();
  if (radius.includes('local')) { score += 15; breakdown.radius = [15, 'local']; }
  else if (radius.includes('regional')) { score += 12; breakdown.radius = [12, 'regional']; }
  else if (radius.includes('long') || radius.includes('interstate')) { score += 8; breakdown.radius = [8, 'long-haul/interstate — fewer markets']; }
  else { score += 10; breakdown.radius = [10, 'radius unknown']; }

  // Hazmat (10 pts) — Cover Whale excludes hazmat; narrows markets
  if (lead.hazmat === true) { breakdown.hazmat = [0, 'hazmat — Cover Whale declines, E&S only']; }
  else if (lead.hazmat === false) { score += 10; breakdown.hazmat = [10, 'no hazmat']; }
  else { score += 5; breakdown.hazmat = [5, 'hazmat unknown']; }

  // Driver-to-unit sanity (15 pts) — driver count present and plausible
  const drivers = lead.driverCount;
  if (drivers != null && units != null && drivers >= units * 0.5 && drivers <= units * 3) {
    score += 15; breakdown.drivers = [15, `${drivers} drivers vs ${units} units — plausible`];
  } else if (drivers != null) {
    score += 8; breakdown.drivers = [8, `${drivers} drivers reported`];
  } else {
    score += 5; breakdown.drivers = [5, 'driver count unknown'];
  }

  return { score: Math.min(100, score), breakdown };
}

// ─── INSURANCE OPPORTUNITY SCORE ───
// Higher = more money, more urgency, easier to reach.
function insuranceOpportunityScore(lead, xdate) {
  const breakdown = {};
  let score = 0;

  // X-date urgency (35 pts) — renewals close; cold ones don't
  if (xdate && xdate.daysToRenewal != null) {
    const d = xdate.daysToRenewal;
    if (d < 0) { score += 15; breakdown.xdate = [15, `renewal passed ${-d}d ago — likely already bound or lapsing`]; }
    else if (d <= 30) { score += 35; breakdown.xdate = [35, `renews in ${d}d — strike zone`]; }
    else if (d <= 60) { score += 30; breakdown.xdate = [30, `renews in ${d}d — active window`]; }
    else if (d <= 90) { score += 22; breakdown.xdate = [22, `renews in ${d}d — early window`]; }
    else { score += 8; breakdown.xdate = [8, `renews in ${d}d — nurture`]; }
  } else {
    score += 10; breakdown.xdate = [10, 'no X-date — discover on the call'];
  }

  // Premium opportunity (25 pts) — fleet size is the best premium proxy
  const units = lead.vehicleCount;
  if (units != null && units >= 10) { score += 25; breakdown.premium = [25, `${units} units — est. $10K+ premium`]; }
  else if (units != null && units >= 5) { score += 20; breakdown.premium = [20, `${units} units — est. $5-10K premium`]; }
  else if (units != null && units >= 2) { score += 15; breakdown.premium = [15, `${units} units — est. $2-5K premium`]; }
  else if (units === 1) { score += 8; breakdown.premium = [8, 'single unit — small premium']; }
  else { score += 10; breakdown.premium = [10, 'fleet unknown']; }

  // Incumbent carrier known (15 pts) — gives Brady a target to beat
  if (lead.currentCarrier) { score += 15; breakdown.carrier = [15, `current carrier: ${lead.currentCarrier}`]; }
  else { breakdown.carrier = [0, 'current carrier unknown']; }

  // Contactability (15 pts) — phone required; email and named contact add
  let contactPts = 0;
  if (lead.phone) contactPts += 8;
  if (lead.email) contactPts += 4;
  if (lead.name && !/business owner/i.test(lead.name)) contactPts += 3; // real person, not placeholder
  score += contactPts;
  breakdown.contactability = [contactPts, contactPts >= 12 ? 'name + phone + email' : contactPts >= 8 ? 'phone + one more channel' : 'phone only'];

  // Source quality (10 pts) — X-date-bearing sources beat cold maps scrapes
  const src = (lead.source || '').toLowerCase();
  if (src.includes('leo') || src.includes('apollo')) { score += 10; breakdown.source = [10, `${lead.source} — has firmographic data`]; }
  else if (src.includes('manual')) { score += 8; breakdown.source = [8, 'manual entry — Dave chose this one']; }
  else if (src.includes('phantom')) { score += 5; breakdown.source = [5, 'Google Maps scrape — cold']; }
  else { score += 5; breakdown.source = [5, lead.source || 'unknown source']; }

  return { score: Math.min(100, score), breakdown };
}

// ─── COMBINED VERDICT ───
function scoreLead(lead, xdate = null) {
  const risk = transportationRiskScore(lead);
  const opportunity = insuranceOpportunityScore(lead, xdate);

  // Opportunity weighs heavier for prioritization — a perfect risk with no
  // renewal window is a nurture, not a dial-today.
  const combined = Math.round(opportunity.score * 0.6 + risk.score * 0.4);

  let band;
  if (combined >= 80) band = 'HOT';
  else if (combined >= 60) band = 'GOOD';
  else if (combined >= 40) band = 'NURTURE';
  else band = 'DONT_WASTE_TIME';

  return {
    riskScore: risk.score,
    opportunityScore: opportunity.score,
    combined,
    band,
    breakdown: { risk: risk.breakdown, opportunity: opportunity.breakdown }
  };
}

module.exports = { transportationRiskScore, insuranceOpportunityScore, scoreLead };
