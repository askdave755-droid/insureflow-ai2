// ============================================
// SMART CHOICE AGENTS - CARRIER APPETITE ENGINE
// src/lib/carriers.js
// Static rules database — no APIs needed
// ============================================

const CARRIER_DATA = [
  ['Cover Whale', ['MI','OH','TX','GA','AZ'], ['trucking','transportation'], 1, 25, 23, 6001, 60, 23, true, false, true, false, true, true, 0, 2, true, true, true, true, ['commercial_auto','cargo','physical_damage'], 400, 2500, false, 24, 'Trucking-only. Max 25 units. NO hazmat. Dashcam + ELD required. Accepts DUIs 5+ years old.'],
  ['Dairyland', ['MI','OH','TX','GA'], ['trucking','transportation','non_standard_auto'], 1, 15, 20, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','non_standard_auto'], 350, 2000, false, 24, 'Non-standard auto specialist. High-risk drivers OK. SR-22 friendly. Max 15 units.'],
  ['Bristol West', ['TX'], ['trucking','transportation','non_standard_auto'], 1, 20, 20, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','non_standard_auto'], 400, 1800, false, 24, 'Farmers subsidiary. Non-standard auto focus. 3-year DUI lookback.'],
  ['Elephant', ['TX','GA'], ['trucking','transportation','non_standard_auto'], 1, 15, 20, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','non_standard_auto'], 350, 1600, false, 24, 'Non-standard auto. Digital-first. 3-year DUI lookback.'],
  ['National General', ['TX'], ['trucking','transportation','non_standard_auto','rv'], 1, 25, 20, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','non_standard_auto','rv'], 400, 2000, false, 24, 'Allstate subsidiary. Non-standard specialist. 3-year DUI.'],
  ['Mercury Insurance', ['TX','GA'], ['trucking','transportation','non_standard_auto'], 1, 25, 20, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','non_standard_auto'], 400, 2000, false, 24, 'CA/TX heavy. Non-standard auto focus. 3-year DUI lookback.'],
  ['Trexis Insurance', ['OH','TX','GA'], ['trucking','transportation','non_standard_auto'], 1, 15, 20, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','non_standard_auto'], 350, 1600, false, 24, 'Non-standard auto. High-risk friendly. 3-year DUI.'],
  ['Orion180', ['TX','GA'], ['trucking','transportation','non_standard_auto'], 1, 15, 20, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','non_standard_auto'], 350, 1500, false, 24, 'Digital non-standard auto. 3-year DUI.'],
  ['Swyft', ['TX'], ['trucking','transportation','non_standard_auto'], 1, 15, 20, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','non_standard_auto'], 350, 1500, false, 24, 'Digital auto. Non-standard friendly. 3-year DUI.'],
  ['Progressive Commercial', ['MI','OH','TX','GA','AZ'], ['trucking','construction','contractors','retail','wholesale','manufacturing','transportation','general'], 1, 500, 25, null, 36, 21, false, true, true, true, true, true, 0, 0, false, false, false, true, ['commercial_auto','general_liability','workers_comp','umbrella','bop'], 400, 6000, true, 2, 'Broad appetite. 3-year DUI lookback. Instant online quotes. Good fallback. Binds fast.'],
  ['The Hartford', ['MI','OH','TX','GA','AZ'], ['construction','manufacturing','contractors','artisans','retail','wholesale','trucking'], 1, 50, null, null, null, 21, false, false, true, false, true, true, 100000, 3, false, false, false, true, ['commercial_auto','workers_comp','general_liability','umbrella','property','bop'], 300, 5000, false, 48, 'NO DUIs allowed. Zero tolerance. Strong for contractors/artisans. Avg commercial auto $574/mo. 3+ years in business preferred.'],
  ['Liberty Mutual', ['MI','OH','TX','GA','AZ'], ['manufacturing','construction','trucking','retail','wholesale','technology'], 5, 200, null, null, 36, 21, false, true, true, false, true, true, 250000, 3, false, false, false, true, ['commercial_auto','workers_comp','general_liability','umbrella','property'], 600, 10000, false, 48, 'Mid-market focus. 3-year DUI lookback. Strong in OH and MI manufacturing. Good for 5-50 unit fleets.'],
  ['Nationwide', ['MI','OH','TX','GA','AZ'], ['construction','manufacturing','trucking','agriculture','retail','general'], 1, 200, null, null, 36, 21, false, true, true, false, true, true, 100000, 2, false, false, false, true, ['commercial_auto','workers_comp','general_liability','umbrella','property','farm'], 500, 8000, false, 48, 'Broad appetite. 3-year DUI. Strong ag/farm. Good for established businesses.'],
  ['Travelers', ['MI','OH','TX','GA','AZ'], ['construction','manufacturing','trucking','retail','wholesale','technology','general'], 1, 500, null, null, 36, 21, false, true, true, true, true, true, 100000, 2, false, false, false, true, ['commercial_auto','workers_comp','general_liability','umbrella','property','cyber'], 500, 12000, false, 48, 'Broad appetite. 3-year DUI lookback. Strong construction and manufacturing. Premium pricing.'],
  ['GEICO', ['OH','TX','GA'], ['trucking','construction','contractors','retail','general'], 1, 100, 20, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','general_liability','umbrella'], 400, 4000, true, 2, 'Broad personal/commercial. 3-year DUI. Instant quotes. Good for small fleets.'],
  ['State Auto', ['MI','OH','TX'], ['contractors','manufacturing','retail','wholesale','agriculture'], 1, 50, 20, null, 36, 21, false, false, true, false, true, true, 100000, 2, false, false, false, true, ['commercial_auto','workers_comp','general_liability','property','umbrella'], 400, 4500, false, 48, 'Regional strength OH/IN/KY. 3-year DUI lookback. Good for local contractors and small manufacturers.'],
  ['Grange', ['MI','OH','GA'], ['contractors','manufacturing','retail','wholesale','agriculture'], 1, 50, 20, null, 36, 21, false, false, true, false, true, true, 100000, 2, false, false, false, true, ['commercial_auto','workers_comp','general_liability','property','umbrella'], 400, 4000, false, 48, 'Regional Midwest. 3-year DUI. Good for small-medium businesses.'],
  ['Allstate', ['MI','OH','GA'], ['construction','contractors','retail','general'], 1, 50, 20, null, 36, 21, false, false, true, false, true, true, 50000, 2, false, false, false, true, ['commercial_auto','general_liability','umbrella','bop'], 400, 3500, false, 48, 'Standard market. 3-year DUI. Good for contractors and small business.'],
  ['AmTrust', ['GA','AZ'], ['contractors','construction','small_business','manufacturing','hospitality'], 1, 25, 20, null, 36, 21, false, false, true, false, true, true, 50000, 1, false, false, false, true, ['commercial_auto','workers_comp','general_liability','bop','umbrella'], 350, 3500, false, 24, 'Small contractor specialist. Max 25 units. 3-year DUI lookback. Strong WC rates. Quick turnaround.'],
  ['Berkshire Hathaway GUARD', ['MI','OH','TX','GA','AZ'], ['construction','manufacturing','trucking','transportation','contractors'], 1, 100, null, null, 24, 21, false, true, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','workers_comp','general_liability','umbrella','property'], 500, 8000, true, 24, 'KEY DIFFERENTIATOR: 2-year DUI lookback (ACCEPTS recent DUIs). Instant bind available. Strong WC. Good for construction risks other carriers decline.'],
  ['LAMAR', ['TX'], ['trucking','construction','manufacturing','energy','oil_gas'], 1, 200, null, null, 12, 21, true, true, true, true, true, true, 0, 0, false, false, false, true, ['commercial_auto','excess','umbrella','general_liability','workers_comp','property'], 800, 15000, false, 72, 'E&S wholesale. A Producers National Company. Texas oil/gas heavy. Accepts hazmat, auto haulers. 1-year DUI lookback.'],
  ['API', ['TX'], ['trucking','construction','manufacturing','energy'], 1, 100, null, null, 12, 21, true, true, true, true, true, true, 0, 0, false, false, false, true, ['commercial_auto','general_liability','umbrella','workers_comp','property'], 700, 12000, false, 48, 'E&S specialist. Texas focus. Accepts hard-to-place risks. 1-year DUI lookback.'],
  ['Allied Trust', ['TX'], ['trucking','construction','manufacturing','energy','oil_gas'], 1, 100, null, null, 24, 21, false, true, true, true, true, true, 0, 1, false, false, false, true, ['commercial_auto','general_liability','umbrella','property'], 600, 10000, false, 48, 'E&S / specialty. Texas heavy. 2-year DUI lookback.'],
  ['CNA', ['OH','AZ'], ['manufacturing','construction','trucking','wholesale','distribution'], 10, 1000, null, null, 36, 21, false, true, true, false, true, true, 5000000, 5, false, false, false, true, ['commercial_auto','workers_comp','general_liability','umbrella','property','professional_liability'], 1500, 25000, false, 72, 'Manufacturing focus. Hazmat OK. 10+ unit minimum for fleet. Targets $5M+ revenue. 3-year DUI lookback. Not for small fleets.'],
  ['CHUBB', ['AZ'], ['manufacturing','distribution','real_estate','technology','healthcare'], 50, 9999, null, null, 60, 21, false, true, true, false, true, true, 10000000, 10, false, false, false, true, ['commercial_auto','workers_comp','general_liability','umbrella','property','professional_liability','cyber'], 3000, 50000, false, 120, 'Large accounts only. $10M+ revenue target. 5-year DUI lookback. Premium pricing but unmatched coverage. Layer over other carriers.'],
  ['Clearcover', ['TX'], ['trucking','transportation','general'], 1, 25, 20, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto'], 350, 2000, true, 2, 'Digital-first auto. Tech-forward. 3-year DUI. Instant quotes.'],
  ['Coterie', ['MI','OH','TX','GA'], ['contractors','small_business','general'], 1, 25, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','general_liability','bop'], 350, 2500, true, 2, 'Digital small business. Quick quotes. 3-year DUI. Good for contractors.'],
  ['Obie', ['MI','OH','TX'], ['landlord','rental_property','small_business'], 1, 50, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['general_liability','property','umbrella'], 300, 3000, true, 2, 'Landlord/rental property specialist. NOT primary commercial auto. Good for BOP + GL.'],
  ['Steadily', ['MI','OH','TX','GA'], ['landlord','rental_property','short_term_rental'], 1, 50, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['general_liability','property','umbrella'], 250, 2500, true, 2, 'Landlord/short-term rental specialist. NOT commercial auto primary. Good for rental property BOP.'],
  ['Lemonade', ['MI','OH','TX','GA'], ['small_business','contractors','general'], 1, 10, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['general_liability','bop','property'], 200, 1500, true, 2, 'Digital-first. Homeowners/rentals primary. Limited commercial auto. Good for small contractor BOP.'],
  ['Openly', ['GA'], ['homeowners','small_business','contractors'], 1, 10, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['general_liability','property','umbrella'], 300, 2000, true, 2, 'Homeowners/small commercial. NOT primary commercial auto.'],
  ['Hiscox', ['MI','OH','TX','GA'], ['contractors','consultants','small_business','professional_services'], 1, 25, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['general_liability','professional_liability','bop','cyber'], 300, 3000, true, 2, 'Small business / BOP specialist. NOT primary commercial auto. Strong GL and professional liability.'],
  ['K2 Specialty', ['AZ'], ['auto_dealer','dealership','garage'], 1, 50, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','garagekeepers','general_liability'], 500, 5000, false, 48, 'Auto dealer insurance specialist. Garagekeepers + dealers open lot.'],
  ['GuideOne', ['AZ'], ['church','religious','non_profit','school'], 1, 50, null, null, 60, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','general_liability','property','umbrella'], 400, 4000, false, 48, 'Church/religious institutions + non-profits. 5-year DUI lookback.'],
  ['Philadelphia Insurance', ['AZ'], ['museum','cultural','social_services','non_profit','recreation'], 1, 50, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','general_liability','property','umbrella','professional_liability'], 400, 4000, false, 48, 'Tokio Marine subsidiary. Specialty: museums, cultural, social services. 3-year DUI.'],
  ['Honeycomb', ['AZ'], ['landlord','rental_property','commercial_real_estate'], 1, 100, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['general_liability','property','umbrella'], 300, 3000, true, 2, 'Commercial real estate / landlord. NOT primary commercial auto.'],
  ['Indigo', ['AZ'], ['landlord','rental_property','commercial_real_estate'], 1, 100, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['general_liability','property','umbrella'], 300, 3000, true, 2, 'Commercial real estate. NOT primary commercial auto.'],
  ['LEEGO', ['AZ'], ['landlord','rental_property','commercial_real_estate'], 1, 100, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['general_liability','property','umbrella'], 300, 3000, true, 2, 'Commercial real estate. NOT primary commercial auto.'],
  ['Risico', ['AZ'], ['landlord','rental_property','commercial_real_estate'], 1, 100, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['general_liability','property','umbrella'], 300, 3000, true, 2, 'Commercial real estate / property. NOT primary commercial auto.'],
  ['SECURA', ['AZ'], ['agriculture','manufacturing','contractors','general'], 1, 100, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','workers_comp','general_liability','property','umbrella','farm'], 400, 5000, false, 48, 'Midwest mutual. Farm + commercial. 3-year DUI.'],
  ['Berkshire Hathaway Homestate', ['AZ'], ['manufacturing','contractors','retail','general'], 1, 100, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','workers_comp','general_liability','property','umbrella'], 400, 5000, false, 48, 'Standard commercial lines. 3-year DUI.'],
  ['Liberty Mutual Surety', ['AZ'], ['construction','contractors','general'], 1, 50, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['surety','commercial_auto','general_liability'], 400, 4000, false, 48, 'Surety bond focus. Limited commercial auto. 3-year DUI.'],
  ['The Hanover', ['MI','OH','TX','GA','AZ'], ['construction','manufacturing','trucking','retail','general'], 1, 200, null, null, 36, 21, false, true, true, false, true, true, 100000, 2, false, false, false, true, ['commercial_auto','workers_comp','general_liability','property','umbrella'], 500, 8000, false, 48, 'Broad appetite. 3-year DUI. Strong in Northeast/Midwest.'],
  ['Main Street America', ['GA'], ['contractors','small_business','manufacturing','general'], 1, 50, null, null, 36, 21, false, false, true, false, true, true, 50000, 2, false, false, false, true, ['commercial_auto','workers_comp','general_liability','property','umbrella'], 400, 4000, false, 48, 'Small business focus. 3-year DUI. Regional Southeast.'],
  ['Encompass', ['GA'], ['contractors','retail','general'], 1, 50, 20, null, 36, 21, false, false, true, false, true, true, 50000, 2, false, false, false, true, ['commercial_auto','general_liability','property','umbrella'], 400, 3500, false, 48, 'Allstate subsidiary. Standard lines. 3-year DUI.'],
  ['Universal Property & Casualty', ['GA'], ['property','landlord','general'], 1, 50, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['property','general_liability','umbrella'], 300, 3000, false, 48, 'Property-heavy. Florida origin. NOT primary commercial auto.'],
  ['Stillwater', ['OH'], ['property','contractors','general'], 1, 50, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['property','general_liability','umbrella'], 300, 3000, false, 48, 'Property/casualty. Coastal/specialty. NOT primary commercial auto.'],
  ['Branch', ['OH','TX'], ['homeowners','small_business','contractors'], 1, 25, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['general_liability','property','umbrella'], 250, 2000, true, 2, 'Digital-first homeowners/small commercial. NOT primary commercial auto.'],
  ['NationalSummit', ['TX','GA'], ['trucking','construction','manufacturing','general'], 1, 100, null, null, 24, 21, false, true, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','general_liability','umbrella','workers_comp'], 500, 8000, false, 48, 'E&S/specialty. 2-year DUI lookback.'],
  ['Commonwealth Auto Insurance', ['TX'], ['trucking','transportation','non_standard_auto'], 1, 25, 20, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','non_standard_auto'], 350, 1800, false, 24, 'Non-standard/specialty auto. 3-year DUI.'],
  ['Premium by Intelliat', ['MI','OH','TX','GA'], ['trucking','construction','contractors','general'], 1, 50, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','general_liability','workers_comp','umbrella'], 400, 4000, false, 48, 'Broad appetite. 3-year DUI.'],
  ['Foremost', ['MI','OH','TX','GA'], ['specialty','mobile_home','non_standard_auto','rv'], 1, 25, 20, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','non_standard_auto','rv'], 350, 2000, false, 24, 'Specialty/non-standard. Mobile homes, RVs. 3-year DUI.'],
  ['Cowbell Cyber', ['MI','OH','TX','GA'], ['technology','healthcare','professional_services','general'], 1, 9999, null, null, null, 21, false, false, true, false, true, true, 0, 0, false, false, false, true, ['cyber','technology_e_o','professional_liability'], 500, 10000, true, 2, 'Cyber insurance specialist. NOT commercial auto. Standalone cyber + tech E&O.'],
  ['Adaptive', ['MI','OH','TX','GA'], ['small_business','contractors','general'], 1, 50, null, null, 36, 21, false, false, true, false, true, true, 0, 1, false, false, false, true, ['commercial_auto','general_liability','bop','property'], 350, 3000, true, 2, 'Digital small business. Quick quotes. 3-year DUI.']
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
    notes: row[26]
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
    needs_reefer = true,
    needs_auto_hauler = false,
    needs_sand_gravel = true
  } = payload;

  let matches = CARRIERS.filter(c => {
    if (!c.states.includes(state.toUpperCase())) return false;
    const vertMatch = c.verticals.includes(vertical) || c.verticals.includes('general');
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
    if (needs_sand_gravel && !c.sand_gravel_allowed) return false;
    return true;
  });

  matches.sort((a, b) => {
    if (a.instant_bind && !b.instant_bind) return -1;
    if (!a.instant_bind && b.instant_bind) return 1;
    return a.quote_turnaround_hours - b.quote_turnaround_hours;
  });

  const instant = matches.filter(r => r.instant_bind);
  const fast = matches.filter(r => !r.instant_bind && r.quote_turnaround_hours <= 24);
  const standard = matches.filter(r => !r.instant_bind && r.quote_turnaround_hours > 24);

  const withReasoning = matches.map(c => {
    let reasons = [];
    if (c.instant_bind) reasons.push('Instant bind');
    if (c.quote_turnaround_hours <= 24) reasons.push('24hr quote');
    if (c.dui_lookback_months && has_dui && c.dui_lookback_months >= (dui_months_ago || 0)) reasons.push('DUI-friendly');
    if (c.hazmat_allowed && has_hazmat) reasons.push('Hazmat OK');
    if (c.min_revenue && revenue && c.min_revenue <= revenue) reasons.push('Revenue fit');
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
