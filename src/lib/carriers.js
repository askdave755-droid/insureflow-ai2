// ============================================
// NEXUS G PARTNERS - CARRIER APPETITE ENGINE
// src/lib/carriers.js
// First Connect Insurance panel — rebuilt Aug 2026
// Access status: 'active' = appointed, 'request' = request access in Carrier Store
// ============================================

// Columns: name, states, verticals, min_vehicles, max_vehicles, max_vehicle_age,
// min_gvwr, dui_lookback_months, min_driver_age, requires_cdl, hazmat_allowed,
// reefer_allowed, auto_hauler_allowed, sand_gravel_allowed, intermodal_allowed,
// min_revenue, min_years_in_business, requires_dot_number, requires_dashcam,
// requires_eld, accepts_owner_ops, lines, premium_range_min, premium_range_max,
// instant_bind, quote_turnaround_hours, notes, access_status
const CARRIER_DATA = [
  ['Cover Whale', ['MI','OH','TX','GA','AZ','AL','TN','IN'], ['trucking','transportation'], 1, 25, 23, 6001, 60, 23, true, false, true, false, true, true, 0, 2, true, true, true, true, ['commercial_auto','cargo','physical_damage'], 400, 2500, false, 24, 'Trucking-only. Max 25 units. NO hazmat. Dashcam + ELD required. Accepts DUIs 5+ years old. APPOINTED — quote direct in First Connect portal.', 'active'],
  ['Nirvana', ['MI','OH','TX','GA','TN','IN'], ['trucking','transportation'], 1, 500, null, null, 36, 21, false, false, true, false, true, true, 0, 0, true, true, true, true, ['commercial_auto','cargo','physical_damage'], 500, 3000, false, 24, 'Telematics-driven trucking. Up to 20% upfront safety discount, pay-per-mile option, rate locked full term, A-rated. Non-fleet 1-9 units AND fleets 10+. Dashcam/telematics required.', 'request'],
  ['Diesel Insurance', ['MI','OH','TX','GA','AZ','AL','TN','IN','FL'], ['trucking','transportation'], 1, 10, null, null, null, 21, false, false, true, false, true, true, 0, 0, false, false, false, true, ['physical_damage','cargo'], 300, 2000, true, 2, 'Trucking physical damage + motor truck cargo MGU. NEW VENTURES OK. All radius including long haul. 48 states (excl AK/HI). Fast online rater.', 'request'],
  ['RT Connector', ['MI','OH','TX','GA','AZ','AL','TN','IN','FL'], ['trucking','transportation'], 1, 10, 23, null, 24, 18, false, true, true, true, true, true, 0, 0, false, false, false, true, ['commercial_auto','cargo','general_liability','excess','physical_damage'], 800, 12000, false, 48, 'E&S via RT Specialty — 25+ carriers, one application. NEW VENTURES eligible. Takes hotshot, reefer, auto haulers, intermodal w/ UIIA. Excl HI/MA/NY. Drivers 18-75 (23+ for >20k lbs). Tractors <23yrs (27 dump).', 'request'],
  ['Forge', ['MI','OH','IN'], ['trucking','contractors','small_business','general'], 1, 200, null, null, 36, 21, false, false, true, false, true, true, 0, 0, false, false, false, true, ['commercial_auto','general_liability'], 400, 4000, false, 24, 'Small business auto. Sweet spot 3-9 unit accounts + larger fleets. Midwest and Mid-Atlantic focus — strong MI/OH/IN.', 'request'],
  ['Employers', ['MI','OH','TX','GA','AZ','AL','TN','IN','FL'], ['general','construction','manufacturing','trucking','contractors','retail','small_business'], 1, 9999, null, null, 36, 21, false, true, true, true, true, true, 0, 0, false, false, false, true, ['workers_comp'], 300, 5000, false, 24, 'Workers comp specialist. 46 states + DC. Small business focus. Pair with any auto quote for account rounding.', 'request'],
  ['Insur-Fi', ['MI','OH','TX','GA','AZ','AL','TN','IN','FL'], ['contractors','manufacturing','wholesale','distribution','real_estate','landlord'], 1, 9999, null, null, 36, 21, false, true, true, false, true, true, 0, 0, false, false, false, true, ['general_liability','workers_comp','property','bop'], 400, 8000, false, 48, 'Boutique wholesale: artisan contractors, manufacturing, warehouse, distribution, habitational, lessor risk, large WC. NOT primary commercial auto.', 'request'],
  ['Hiscox', ['MI','OH','TX','GA','AZ','AL','TN','IN','FL'], ['contractors','consultants','small_business','professional_services'], 1, 25, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['general_liability','professional_liability','bop','cyber'], 300, 3000, true, 2, 'Small business GL / professional liability / BOP / cyber. Instant bind. Up to $5M revenue. NOT commercial auto.', 'request'],
  ['RLI', ['MI','OH','TX','GA','AZ','AL','TN','IN','FL'], ['contractors','construction'], 1, 100, null, null, 36, 21, false, false, true, false, true, true, 0, 0, false, false, false, true, ['general_liability','umbrella','inland_marine','surety'], 400, 5000, false, 48, 'Contrac Pac: artisan contractors GL + inland marine + BPP. A+ rated. Also umbrella and surety bonds.', 'request'],
  ['Cowbell Cyber', ['MI','OH','TX','GA','AZ','AL','TN','IN','FL'], ['technology','healthcare','professional_services','general'], 1, 9999, null, null, null, 21, false, false, true, false, true, true, 0, 0, false, false, false, true, ['cyber','technology_e_o','professional_liability'], 500, 10000, true, 2, 'Cyber insurance specialist. NOT commercial auto. Standalone cyber + tech E&O. Good cross-sell on any qualified account.', 'request'],
  ['CrossCover', ['MI','OH','TX','GA','AZ','AL','TN','IN','FL'], ['general','landlord','real_estate'], 1, 9999, null, null, null, 21, false, false, true, false, true, true, 0, 0, false, false, false, true, ['property'], 500, 8000, false, 48, 'E&S commercial property MGU. Property only — pair for account rounding on real estate / landlord risks.', 'request']
];

function toCarrierObj(row) {
  return {
    carrier_name: row[0],
    states: row[1],
    verticals: row[2],
    min_vehicles: row[3],
    max_vehicles: row[4],
    max_vehicle_age: row[5],
    min_gvwr: row[6],
    dui_lookback_months: row[7],
    min_driver_age: row[8],
    requires_cdl: row[9],
    hazmat_allowed: row[10],
    reefer_allowed: row[11],
    auto_hauler_allowed: row[12],
    sand_gravel_allowed: row[13],
    intermodal_allowed: row[14],
    min_revenue: row[15],
    min_years_in_business: row[16],
    requires_dot_number: row[17],
    requires_dashcam: row[18],
    requires_eld: row[19],
    accepts_owner_ops: row[20],
    lines: row[21],
    premium_range_min: row[22],
    premium_range_max: row[23],
    instant_bind: row[24],
    quote_turnaround_hours: row[25],
    notes: row[26],
    access_status: row[27]
  };
}

const CARRIERS = CARRIER_DATA.map(toCarrierObj);

function matchCarriers(payload) {
  const {
    state,
    vertical = 'trucking',
    vehicle_count = 1,
    vehicle_age,
    has_hazmat = false,
    has_dui = false,
    dui_months_ago,
    revenue = 0,
    years_in_business = 0,
    needs_reefer = false,
    needs_auto_hauler = false,
    needs_sand_gravel = false
  } = payload;

  let matches = CARRIERS.filter(c => {
    if (!c.states.includes(state.toUpperCase())) return false;
    // 'general' vertical only counts if the carrier actually writes commercial_auto
    const vertMatch = c.verticals.includes(vertical) ||
      (c.verticals.includes('general') && c.lines.includes('commercial_auto'));
    if (!vertMatch) return false;
    if (vehicle_count < c.min_vehicles || vehicle_count > c.max_vehicles) return false;
    if (vehicle_age && c.max_vehicle_age && vehicle_age > c.max_vehicle_age) return false;
    if (has_hazmat && !c.hazmat_allowed) return false;
    if (has_dui) {
      if (c.dui_lookback_months === null) return false;
      if (dui_months_ago && c.dui_lookback_months < dui_months_ago) return false;
    }
    if (revenue && c.min_revenue && revenue < c.min_revenue) return false;
    if (years_in_business && c.min_years_in_business && years_in_business < c.min_years_in_business) return false;
    if (needs_reefer && !c.reefer_allowed) return false;
    if (needs_auto_hauler && !c.auto_hauler_allowed) return false;
    if (needs_sand_gravel && !c.needs_sand_gravel) return false;
    return true;
  });

  // Appointed carriers first, then instant bind, then fastest quote
  matches.sort((a, b) => {
    if (a.access_status === 'active' && b.access_status !== 'active') return -1;
    if (a.access_status !== 'active' && b.access_status === 'active') return 1;
    if (a.instant_bind && !b.instant_bind) return -1;
    if (!a.instant_bind && b.instant_bind) return 1;
    return a.quote_turnaround_hours - b.quote_turnaround_hours;
  });

  const instant = matches.filter(r => r.instant_bind);
  const fast = matches.filter(r => !r.instant_bind && r.quote_turnaround_hours <= 24);
  const standard = matches.filter(r => !r.instant_bind && r.quote_turnaround_hours > 24);

  const withReasoning = matches.map(c => {
    let reasons = [];
    if (c.access_status === 'active') reasons.push('APPOINTED');
    if (c.instant_bind) reasons.push('Instant bind');
    if (c.quote_turnaround_hours <= 24) reasons.push('24hr quote');
    if (c.dui_lookback_months && has_dui && c.dui_lookback_months >= (dui_months_ago || 0)) reasons.push('DUI-friendly');
    if (c.hazmat_allowed && has_hazmat) reasons.push('Hazmat OK');
    if (c.min_years_in_business === 0) reasons.push('New ventures OK');
    return { ...c, match_reasons: reasons };
  });

  return {
    match_count: matches.length,
    instant_bind: instant,
    fast_turnaround: fast,
    standard: standard,
    top_pick: matches[0] || null,
    all_matches: withReasoning,
    disqualified_reason: matches.length === 0 ? 'No carriers match this risk profile' : null
  };
}

function getCarrierNames(state) {
  return CARRIERS.filter(c => c.states.includes(state.toUpperCase()))
    .map(c => c.carrier_name)
    .sort();
}

function getTopCarriersForLead(lead) {
  const result = matchCarriers({
    state: lead.state,
    vertical: lead.industry || 'trucking',
    vehicle_count: lead.vehicle_count || lead.vehicleCount || 1,
    has_hazmat: lead.hazmat || false,
    has_dui: lead.has_dui || false,
    dui_months_ago: lead.dui_months_ago || null,
    revenue: lead.revenue || 0,
    years_in_business: lead.years_in_business || 0
  });
  const top3 = result.all_matches.slice(0, 3).map(c => c.carrier_name).join(', ');
  return { top3, fullData: result };
}

module.exports = {
  matchCarriers,
  getCarrierNames,
  getTopCarriersForLead,
  CARRIERS
};
