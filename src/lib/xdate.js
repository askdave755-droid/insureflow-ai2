// ─── X-DATE / RENEWAL INTELLIGENCE (Phase 2) ─────────────────────────
// The X-date is the single most valuable field in commercial insurance
// prospecting. This module turns a raw date into a selling strategy.

function analyzeXDate(xDate) {
  if (!xDate) {
    return {
      daysToRenewal: null,
      tier: 'UNKNOWN',
      pitchAngle: 'discover',       // Brady's call must surface the X-date
      scriptHint: 'First job on this call: find out when the policy renews.'
    };
  }

  const renewal = new Date(xDate);
  const today = new Date();
  const days = Math.ceil((renewal - today) / (1000 * 60 * 60 * 24));

  if (days < -90) {
    return { daysToRenewal: days, tier: 'STALE', pitchAngle: 'verify',
      scriptHint: `X-date shows ${renewal.toLocaleDateString()} — likely already renewed. Verify the real current X-date.` };
  }
  if (days < 0) {
    return { daysToRenewal: days, tier: 'LAPSED_WINDOW', pitchAngle: 'urgent_save',
      scriptHint: `Renewal passed ${-days} days ago — either just bound (ask how it went, plant the seed for next year) or lapsing (emergency placement).` };
  }
  if (days <= 14) {
    return { daysToRenewal: days, tier: 'CRITICAL', pitchAngle: 'last_call',
      scriptHint: `Renews in ${days} days — last chance to quote. Push hard for dec pages TODAY.` };
  }
  if (days <= 30) {
    return { daysToRenewal: days, tier: 'STRIKE_ZONE', pitchAngle: 'quote_now',
      scriptHint: `Renews in ${days} days — carriers can still quote. Get dec pages this week.` };
  }
  if (days <= 60) {
    return { daysToRenewal: days, tier: 'ACTIVE', pitchAngle: 'early_bird',
      scriptHint: `Renews in ${days} days — perfect timing: enough runway to shop properly, close enough to matter.` };
  }
  if (days <= 90) {
    return { daysToRenewal: days, tier: 'EARLY', pitchAngle: 'plant_flag',
      scriptHint: `Renews in ${days} days — plant the flag, promise a comparison at the 60-day mark.` };
  }
  return { daysToRenewal: days, tier: 'NURTURE', pitchAngle: 'nurture',
    scriptHint: `Renews in ${days} days (${renewal.toLocaleDateString()}) — log it, nurture, re-engage at 90 days.` };
}

// Days until we should re-engage a NURTURE-tier prospect (90-day mark).
function daysUntilReengage(xDate) {
  if (!xDate) return null;
  const days = Math.ceil((new Date(xDate) - new Date()) / (1000 * 60 * 60 * 24));
  return Math.max(days - 90, 1);
}

module.exports = { analyzeXDate, daysUntilReengage };
