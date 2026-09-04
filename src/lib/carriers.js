// ============================================
// SMART CHOICE AGENTS + FIRST CONNECT
// COMPLETE CARRIER APPETITE DATABASE
// src/lib/carriers.js
// ============================================

const CARRIERS = [
  // ═══════════════════════════════════════════════════════════
  // FIRST CONNECT CARRIERS (Original 11)
  // ═══════════════════════════════════════════════════════════
  {
    carrier_name: "Cover Whale",
    states: ["MI","OH","TX","GA","AZ","FL","NC","SC","TN","IN","WI","IL","PA","NY","NJ"],
    verticals: ["trucking","transportation"],
    min_vehicles: 1, max_vehicles: 25, max_vehicle_age: 23, min_gvwr: 6001,
    dui_lookback_months: 60, min_driver_age: 23, requires_cdl: true,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 2, requires_dot_number: true,
    requires_dashcam: true, requires_eld: true, accepts_owner_ops: true,
    lines: ["commercial_auto","cargo","physical_damage"],
    premium_range_min: 400, premium_range_max: 2500,
    instant_bind: false, quote_turnaround_hours: 24,
    notes: "Trucking-only. Max 25 power units. NO hazmat. Dashcam + ELD required. Accepts DUIs 5+ years old. Owner-ops OK.",
    access_status: "active", source_panel: "first_connect"
  },
  {
    carrier_name: "Nirvana",
    states: ["TX","FL","GA","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","AZ","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD"],
    verticals: ["trucking","transportation","construction","general"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","workers_comp","umbrella"],
    premium_range_min: 500, premium_range_max: 5000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Broad appetite. 3-year DUI lookback. Good for mixed fleets.",
    access_status: "request", source_panel: "first_connect"
  },
  {
    carrier_name: "Diesel Insurance",
    states: ["TX","OK","AR","LA","NM","AZ","NV","UT","CO","KS","NE","SD","ND","MT","WY","ID","WA","OR","CA"],
    verticals: ["trucking","transportation","oil_gas"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: 25,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: true,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: true,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 2, requires_dot_number: true,
    requires_dashcam: false, requires_eld: true, accepts_owner_ops: true,
    lines: ["commercial_auto","cargo","physical_damage","general_liability"],
    premium_range_min: 600, premium_range_max: 8000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Southwest heavy. Oil/gas friendly. Hazmat OK. E&S appetite.",
    access_status: "request", source_panel: "first_connect"
  },
  {
    carrier_name: "RT Connector",
    states: ["TX","FL","GA","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","AZ","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD"],
    verticals: ["trucking","transportation","logistics","general"],
    min_vehicles: 1, max_vehicles: 200, max_vehicle_age: 20,
    dui_lookback_months: 24, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","workers_comp","umbrella"],
    premium_range_min: 400, premium_range_max: 6000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "2-year DUI lookback. Broad transportation appetite.",
    access_status: "request", source_panel: "first_connect"
  },
  {
    carrier_name: "Forge",
    states: ["TX","FL","GA","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","AZ","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD"],
    verticals: ["trucking","transportation","construction","manufacturing"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 2, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","workers_comp","umbrella"],
    premium_range_min: 500, premium_range_max: 7000,
    instant_bind: false, quote_turnaround_hours: 72,
    notes: "Mid-market focus. Manufacturing + trucking. 3-year DUI.",
    access_status: "request", source_panel: "first_connect"
  },
  {
    carrier_name: "Employers",
    states: ["CA","TX","FL","GA","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","AZ","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD"],
    verticals: ["small_business","contractors","retail","hospitality","general"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["workers_comp","commercial_auto","general_liability","bop"],
    premium_range_min: 300, premium_range_max: 4000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Small business specialist. Strong WC. Limited commercial auto.",
    access_status: "request", source_panel: "first_connect"
  },
  {
    carrier_name: "Insur-Fi",
    states: ["TX","FL","GA","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","AZ","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD"],
    verticals: ["trucking","transportation","construction","general"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","workers_comp","umbrella"],
    premium_range_min: 400, premium_range_max: 6000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Broad appetite. Digital-first. Quick quotes.",
    access_status: "request", source_panel: "first_connect"
  },
  {
    carrier_name: "Hiscox",
    states: ["MI","OH","TX","GA","AZ","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD"],
    verticals: ["contractors","consultants","small_business","professional_services"],
    min_vehicles: 1, max_vehicles: 25, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 0, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["general_liability","professional_liability","bop","cyber"],
    premium_range_min: 300, premium_range_max: 3000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Small business / BOP specialist. NOT primary commercial auto. Strong GL and professional liability.",
    access_status: "request", source_panel: "first_connect"
  },
  {
    carrier_name: "RLI",
    states: ["TX","FL","GA","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","AZ","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD"],
    verticals: ["contractors","manufacturing","distribution","general"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 2, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","workers_comp","umbrella"],
    premium_range_min: 500, premium_range_max: 8000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Contractor + manufacturing focus. 3-year DUI. Mid-market.",
    access_status: "request", source_panel: "first_connect"
  },
  {
    carrier_name: "Cowbell Cyber",
    states: ["MI","OH","TX","GA","AZ","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD"],
    verticals: ["technology","healthcare","professional_services","general"],
    min_vehicles: 1, max_vehicles: 9999, max_vehicle_age: null,
    dui_lookback_months: null, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 0, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["cyber","technology_e_o","professional_liability"],
    premium_range_min: 500, premium_range_max: 10000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Cyber insurance specialist. NOT commercial auto. Standalone cyber + tech E&O.",
    access_status: "request", source_panel: "first_connect"
  },
  {
    carrier_name: "CrossCover",
    states: ["TX","FL","GA","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","AZ","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD"],
    verticals: ["trucking","transportation","construction","general"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","workers_comp","umbrella"],
    premium_range_min: 400, premium_range_max: 6000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Broad appetite. 3-year DUI. Good for mixed fleets.",
    access_status: "request", source_panel: "first_connect"
  },

  // ═══════════════════════════════════════════════════════════
  // SMART CHOICE CARRIERS — MI, OH, TX, GA, AZ
  // ═══════════════════════════════════════════════════════════

  // ─── TRUCKING / COMMERCIAL AUTO SPECIALISTS ───
  {
    carrier_name: "Dairyland",
    states: ["MI","OH","TX","GA"],
    verticals: ["trucking","transportation","non_standard_auto"],
    min_vehicles: 1, max_vehicles: 15, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","non_standard_auto"],
    premium_range_min: 350, premium_range_max: 2000,
    instant_bind: false, quote_turnaround_hours: 24,
    notes: "Non-standard auto specialist. High-risk drivers OK. SR-22 friendly. Max 15 units. 3-year DUI lookback.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Bristol West",
    states: ["TX"],
    verticals: ["trucking","transportation","non_standard_auto"],
    min_vehicles: 1, max_vehicles: 20, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","non_standard_auto"],
    premium_range_min: 400, premium_range_max: 1800,
    instant_bind: false, quote_turnaround_hours: 24,
    notes: "Farmers subsidiary. Non-standard auto focus. 3-year DUI lookback.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Elephant",
    states: ["TX","GA"],
    verticals: ["trucking","transportation","non_standard_auto"],
    min_vehicles: 1, max_vehicles: 15, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","non_standard_auto"],
    premium_range_min: 350, premium_range_max: 1600,
    instant_bind: false, quote_turnaround_hours: 24,
    notes: "Non-standard auto. Digital-first. 3-year DUI lookback. Limited fleet size.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "National General",
    states: ["TX"],
    verticals: ["trucking","transportation","non_standard_auto","rv"],
    min_vehicles: 1, max_vehicles: 25, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","non_standard_auto","rv"],
    premium_range_min: 400, premium_range_max: 2000,
    instant_bind: false, quote_turnaround_hours: 24,
    notes: "Allstate subsidiary. Non-standard specialist. 3-year DUI. Good for mixed risk fleets.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Mercury Insurance",
    states: ["TX","GA"],
    verticals: ["trucking","transportation","non_standard_auto"],
    min_vehicles: 1, max_vehicles: 25, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","non_standard_auto"],
    premium_range_min: 400, premium_range_max: 2000,
    instant_bind: false, quote_turnaround_hours: 24,
    notes: "CA/TX heavy. Non-standard auto focus. 3-year DUI lookback.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Trexis Insurance",
    states: ["OH","TX","GA"],
    verticals: ["trucking","transportation","non_standard_auto"],
    min_vehicles: 1, max_vehicles: 15, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","non_standard_auto"],
    premium_range_min: 350, premium_range_max: 1600,
    instant_bind: false, quote_turnaround_hours: 24,
    notes: "Non-standard auto. High-risk friendly. 3-year DUI.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Orion180",
    states: ["TX","GA"],
    verticals: ["trucking","transportation","non_standard_auto"],
    min_vehicles: 1, max_vehicles: 15, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","non_standard_auto"],
    premium_range_min: 350, premium_range_max: 1500,
    instant_bind: false, quote_turnaround_hours: 24,
    notes: "Digital non-standard auto. 3-year DUI.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Swyft",
    states: ["TX"],
    verticals: ["trucking","transportation","non_standard_auto"],
    min_vehicles: 1, max_vehicles: 15, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","non_standard_auto"],
    premium_range_min: 350, premium_range_max: 1500,
    instant_bind: false, quote_turnaround_hours: 24,
    notes: "Digital auto. Non-standard friendly. 3-year DUI.",
    access_status: "active", source_panel: "smart_choice"
  },

  // ─── BROAD APPETITE / STANDARD MARKET ───
  {
    carrier_name: "Progressive Commercial",
    states: ["MI","OH","TX","GA","AZ","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK"],
    verticals: ["trucking","construction","contractors","retail","wholesale","manufacturing","transportation","general"],
    min_vehicles: 1, max_vehicles: 500, max_vehicle_age: 25,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: true,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 0, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","workers_comp","umbrella","bop"],
    premium_range_min: 400, premium_range_max: 6000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Broad appetite. 3-year DUI lookback. Instant online quotes. Good fallback. Binds fast. Nationwide coverage.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "The Hartford",
    states: ["MI","OH","TX","GA","AZ","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK"],
    verticals: ["construction","manufacturing","contractors","artisans","retail","wholesale","trucking"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: null,
    dui_lookback_months: null, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 100000, min_years_in_business: 3, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","umbrella","property","bop"],
    premium_range_min: 300, premium_range_max: 5000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "NO DUIs allowed. Zero tolerance. Strong for contractors/artisans. Avg commercial auto $574/mo. 3+ years in business preferred. Premium standard market carrier.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Liberty Mutual",
    states: ["MI","OH","TX","GA","AZ","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK"],
    verticals: ["manufacturing","construction","trucking","retail","wholesale","technology"],
    min_vehicles: 5, max_vehicles: 200, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 250000, min_years_in_business: 3, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","umbrella","property"],
    premium_range_min: 600, premium_range_max: 10000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Mid-market focus. 3-year DUI lookback. Strong in OH and MI manufacturing. Good for 5-50 unit fleets. Requires $250K+ revenue.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Nationwide",
    states: ["MI","OH","TX","GA","AZ","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK"],
    verticals: ["construction","manufacturing","trucking","agriculture","retail","general"],
    min_vehicles: 1, max_vehicles: 200, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 100000, min_years_in_business: 2, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","umbrella","property","farm"],
    premium_range_min: 500, premium_range_max: 8000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Broad appetite. 3-year DUI. Strong ag/farm. Good for established businesses. Nationwide coverage.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Travelers",
    states: ["MI","OH","TX","GA","AZ","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK"],
    verticals: ["construction","manufacturing","trucking","retail","wholesale","technology","general"],
    min_vehicles: 1, max_vehicles: 500, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: true,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 100000, min_years_in_business: 2, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","umbrella","property","cyber"],
    premium_range_min: 500, premium_range_max: 12000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Broad appetite. 3-year DUI lookback. Strong construction and manufacturing. Premium pricing. Large account specialist.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "GEICO",
    states: ["OH","TX","GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK"],
    verticals: ["trucking","construction","contractors","retail","general"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","umbrella"],
    premium_range_min: 400, premium_range_max: 4000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Broad personal/commercial. 3-year DUI. Instant quotes. Good for small fleets. Not available in MI or AZ.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "State Auto",
    states: ["MI","OH","TX","IN","KY","WV","VA","NC","SC","GA","FL","TN","PA","NY","IL","WI","MN","IA","MO","KS","NE","SD","ND","CO","UT","AZ","NM"],
    verticals: ["contractors","manufacturing","retail","wholesale","agriculture"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 100000, min_years_in_business: 2, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","property","umbrella"],
    premium_range_min: 400, premium_range_max: 4500,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Regional strength OH/IN/KY. 3-year DUI lookback. Good for local contractors and small manufacturers. Not available in all states.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Grange",
    states: ["MI","OH","GA","IN","KY","WV","VA","NC","SC","FL","TN","PA","IL","WI","MN","IA","MO","KS","NE","SD","ND","CO","UT","AZ","NM"],
    verticals: ["contractors","manufacturing","retail","wholesale","agriculture"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 100000, min_years_in_business: 2, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","property","umbrella"],
    premium_range_min: 400, premium_range_max: 4000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Regional Midwest. 3-year DUI. Good for small-medium businesses. Not available in TX.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Allstate",
    states: ["MI","OH","GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","TX","AZ"],
    verticals: ["construction","contractors","retail","general"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 50000, min_years_in_business: 2, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","umbrella","bop"],
    premium_range_min: 400, premium_range_max: 3500,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Standard market. 3-year DUI. Good for contractors and small business. Broad state coverage.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "AmTrust",
    states: ["GA","AZ","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","TX","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK"],
    verticals: ["contractors","construction","small_business","manufacturing","hospitality"],
    min_vehicles: 1, max_vehicles: 25, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 50000, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","bop","umbrella"],
    premium_range_min: 350, premium_range_max: 3500,
    instant_bind: false, quote_turnaround_hours: 24,
    notes: "Small contractor specialist. Max 25 units. 3-year DUI lookback. Strong WC rates. Quick turnaround. Not available in all states.",
    access_status: "active", source_panel: "smart_choice"
  },

  // ─── E&S / WHOLESALE / HARD-TO-PLACE ───
  {
    carrier_name: "Berkshire Hathaway GUARD",
    states: ["MI","OH","TX","GA","AZ","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK"],
    verticals: ["construction","manufacturing","trucking","transportation","contractors"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: null,
    dui_lookback_months: 24, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","umbrella","property"],
    premium_range_min: 500, premium_range_max: 8000,
    instant_bind: true, quote_turnaround_hours: 24,
    notes: "KEY DIFFERENTIATOR: 2-year DUI lookback (ACCEPTS recent DUIs). Instant bind available. Strong WC. Good for construction risks other carriers decline. Nationwide coverage.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "LAMAR",
    states: ["TX","OK","AR","LA","NM"],
    verticals: ["trucking","construction","manufacturing","energy","oil_gas"],
    min_vehicles: 1, max_vehicles: 200, max_vehicle_age: null,
    dui_lookback_months: 12, min_driver_age: 21, requires_cdl: true,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: true,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 0, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","excess","umbrella","general_liability","workers_comp","property"],
    premium_range_min: 800, premium_range_max: 15000,
    instant_bind: false, quote_turnaround_hours: 72,
    notes: "E&S wholesale. A Producers National Company. Texas oil/gas heavy. Accepts hazmat, auto haulers. 1-year DUI lookback. Higher premiums but writes risks others won't. TX only.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "API",
    states: ["TX","OK","AR","LA","NM"],
    verticals: ["trucking","construction","manufacturing","energy"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: null,
    dui_lookback_months: 12, min_driver_age: 21, requires_cdl: true,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: true,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 0, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","umbrella","workers_comp","property"],
    premium_range_min: 700, premium_range_max: 12000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "E&S specialist. Texas focus. Accepts hard-to-place risks. 1-year DUI lookback. TX only.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Allied Trust",
    states: ["TX","OK","AR","LA","NM"],
    verticals: ["trucking","construction","manufacturing","energy","oil_gas"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: null,
    dui_lookback_months: 24, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: true,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","umbrella","property"],
    premium_range_min: 600, premium_range_max: 10000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "E&S / specialty. Texas heavy. 2-year DUI lookback. TX only.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "CNA",
    states: ["OH","AZ","IL","IN","WI","MN","IA","MO","KS","NE","SD","ND","CO","UT","NM","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","NC","SC","GA","FL","AL","MS","LA","AR","OK","TX","CA","NV","OR","WA","ID","MT","WY","HI","AK"],
    verticals: ["manufacturing","construction","trucking","wholesale","distribution"],
    min_vehicles: 10, max_vehicles: 1000, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 5000000, min_years_in_business: 5, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","umbrella","property","professional_liability"],
    premium_range_min: 1500, premium_range_max: 25000,
    instant_bind: false, quote_turnaround_hours: 72,
    notes: "Manufacturing focus. Hazmat OK. 10+ unit minimum for fleet. Targets $5M+ revenue. 3-year DUI lookback. Not for small fleets. Large account specialist.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "CHUBB",
    states: ["AZ","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","HI","AK","TX","FL","NC","SC","GA","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA"],
    verticals: ["manufacturing","distribution","real_estate","technology","healthcare"],
    min_vehicles: 50, max_vehicles: 9999, max_vehicle_age: null,
    dui_lookback_months: 60, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 10000000, min_years_in_business: 10, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","umbrella","property","professional_liability","cyber"],
    premium_range_min: 3000, premium_range_max: 50000,
    instant_bind: false, quote_turnaround_hours: 120,
    notes: "Large accounts only. $10M+ revenue target. 5-year DUI lookback. Premium pricing but unmatched coverage. Layer over other carriers. Elite clientele.",
    access_status: "active", source_panel: "smart_choice"
  },

  // ─── DIGITAL / TECH-FORWARD ───
  {
    carrier_name: "Clearcover",
    states: ["TX","IL","IN","OH","WI","MN","IA","MO","KS","NE","SD","ND","CO","UT","AZ","NM","CA","NV","OR","WA","ID","MT","WY","HI","AK"],
    verticals: ["trucking","transportation","general"],
    min_vehicles: 1, max_vehicles: 25, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto"],
    premium_range_min: 350, premium_range_max: 2000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Digital-first auto. Tech-forward. 3-year DUI. Instant quotes. Limited states.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Coterie",
    states: ["MI","OH","TX","GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["contractors","small_business","general"],
    min_vehicles: 1, max_vehicles: 25, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","bop"],
    premium_range_min: 350, premium_range_max: 2500,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Digital small business. Quick quotes. 3-year DUI. Good for contractors. Broad state coverage.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Obie",
    states: ["MI","OH","TX","GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["landlord","rental_property","small_business"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["general_liability","property","umbrella"],
    premium_range_min: 300, premium_range_max: 3000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Landlord/rental property specialist. NOT primary commercial auto. Good for BOP + GL. Digital-first.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Steadily",
    states: ["MI","OH","TX","GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["landlord","rental_property","short_term_rental"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["general_liability","property","umbrella"],
    premium_range_min: 250, premium_range_max: 2500,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Landlord/short-term rental specialist. NOT commercial auto primary. Good for rental property BOP. Digital-first.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Lemonade",
    states: ["MI","OH","TX","GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["small_business","contractors","general"],
    min_vehicles: 1, max_vehicles: 10, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["general_liability","bop","property"],
    premium_range_min: 200, premium_range_max: 1500,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Digital-first. Homeowners/rentals primary. Limited commercial auto. Good for small contractor BOP. Max 10 units.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Openly",
    states: ["GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","TX","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["homeowners","small_business","contractors"],
    min_vehicles: 1, max_vehicles: 10, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["general_liability","property","umbrella"],
    premium_range_min: 300, premium_range_max: 2000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Homeowners/small commercial. NOT primary commercial auto. Digital-first.",
    access_status: "active", source_panel: "smart_choice"
  },

  // ─── SPECIALTY / NICHE ───
  {
    carrier_name: "K2 Specialty",
    states: ["AZ","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","HI","AK","TX","FL","NC","SC","GA","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA"],
    verticals: ["auto_dealer","dealership","garage"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","garagekeepers","general_liability"],
    premium_range_min: 500, premium_range_max: 5000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Auto dealer insurance specialist. Garagekeepers + dealers open lot. Dealer-focused only.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "GuideOne",
    states: ["AZ","IA","MN","WI","IL","IN","OH","MI","MO","KS","NE","SD","ND","CO","UT","NM","TX","OK","AR","LA","MS","AL","TN","KY","WV","VA","NC","SC","GA","FL","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","CA","NV","OR","WA","ID","MT","WY","HI","AK"],
    verticals: ["church","religious","non_profit","school"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: null,
    dui_lookback_months: 60, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","property","umbrella"],
    premium_range_min: 400, premium_range_max: 4000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Church/religious institutions + non-profits. 5-year DUI lookback. Niche market only.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Philadelphia Insurance",
    states: ["AZ","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","HI","AK","TX","FL","NC","SC","GA","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA"],
    verticals: ["museum","cultural","social_services","non_profit","recreation"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","property","umbrella","professional_liability"],
    premium_range_min: 400, premium_range_max: 4000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Tokio Marine subsidiary. Specialty: museums, cultural, social services. 3-year DUI. Niche market only.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Honeycomb",
    states: ["AZ","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","HI","AK","TX","FL","NC","SC","GA","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA"],
    verticals: ["landlord","rental_property","commercial_real_estate"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["general_liability","property","umbrella"],
    premium_range_min: 300, premium_range_max: 3000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Commercial real estate / landlord. NOT primary commercial auto. Digital-first.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Indigo",
    states: ["AZ","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","HI","AK","TX","FL","NC","SC","GA","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA"],
    verticals: ["landlord","rental_property","commercial_real_estate"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["general_liability","property","umbrella"],
    premium_range_min: 300, premium_range_max: 3000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Commercial real estate. NOT primary commercial auto. Digital-first.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "LEEGO",
    states: ["AZ","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","HI","AK","TX","FL","NC","SC","GA","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA"],
    verticals: ["landlord","rental_property","commercial_real_estate"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["general_liability","property","umbrella"],
    premium_range_min: 300, premium_range_max: 3000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Commercial real estate. NOT primary commercial auto. Digital-first.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Risico",
    states: ["AZ","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","HI","AK","TX","FL","NC","SC","GA","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA"],
    verticals: ["landlord","rental_property","commercial_real_estate"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["general_liability","property","umbrella"],
    premium_range_min: 300, premium_range_max: 3000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Commercial real estate / property. NOT primary commercial auto. Digital-first.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "SECURA",
    states: ["AZ","WI","IL","IN","OH","MI","MN","IA","MO","KS","NE","SD","ND","CO","UT","NM","TX","OK","AR","LA","MS","AL","TN","KY","WV","VA","NC","SC","GA","FL","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","CA","NV","OR","WA","ID","MT","WY","HI","AK"],
    verticals: ["agriculture","manufacturing","contractors","general"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","property","umbrella","farm"],
    premium_range_min: 400, premium_range_max: 5000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Midwest mutual. Farm + commercial. 3-year DUI. Strong in WI, IL, IN, OH, MI.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Berkshire Hathaway Homestate",
    states: ["AZ","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","HI","AK","TX","OK","AR","LA","MS","AL","TN","KY","WV","VA","NC","SC","GA","FL","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","OH","MI","IN","IL","WI","MN","IA","MO","KS","NE","SD","ND"],
    verticals: ["manufacturing","contractors","retail","general"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","property","umbrella"],
    premium_range_min: 400, premium_range_max: 5000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Standard commercial lines. 3-year DUI. Broad state coverage.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Liberty Mutual Surety",
    states: ["AZ","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","HI","AK","TX","OK","AR","LA","MS","AL","TN","KY","WV","VA","NC","SC","GA","FL","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","OH","MI","IN","IL","WI","MN","IA","MO","KS","NE","SD","ND"],
    verticals: ["construction","contractors","general"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["surety","commercial_auto","general_liability"],
    premium_range_min: 400, premium_range_max: 4000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Surety bond focus. Limited commercial auto. 3-year DUI. Construction/contractor specialist.",
    access_status: "active", source_panel: "smart_choice"
  },

  // ─── REGIONAL / MUTUAL ───
  {
    carrier_name: "The Hanover",
    states: ["MI","OH","TX","GA","AZ","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK"],
    verticals: ["construction","manufacturing","trucking","retail","general"],
    min_vehicles: 1, max_vehicles: 200, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 100000, min_years_in_business: 2, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","property","umbrella"],
    premium_range_min: 500, premium_range_max: 8000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Broad appetite. 3-year DUI. Strong in Northeast/Midwest. Good for mid-market.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Main Street America",
    states: ["GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","TX","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["contractors","small_business","manufacturing","general"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 50000, min_years_in_business: 2, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","workers_comp","general_liability","property","umbrella"],
    premium_range_min: 400, premium_range_max: 4000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Small business focus. 3-year DUI. Regional Southeast. Good for contractors.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Encompass",
    states: ["GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","TX","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["contractors","retail","general"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 50000, min_years_in_business: 2, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","property","umbrella"],
    premium_range_min: 400, premium_range_max: 3500,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Allstate subsidiary. Standard lines. 3-year DUI. Broad state coverage.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Universal Property & Casualty",
    states: ["GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","TX","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["property","landlord","general"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["property","general_liability","umbrella"],
    premium_range_min: 300, premium_range_max: 3000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Property-heavy. Florida origin. NOT primary commercial auto. Coastal/specialty.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Stillwater",
    states: ["OH","MI","IN","IL","WI","MN","IA","MO","KS","NE","SD","ND","CO","UT","NM","TX","OK","AR","LA","MS","AL","TN","KY","WV","VA","NC","SC","GA","FL","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","CA","NV","OR","WA","ID","MT","WY","HI","AK","AZ"],
    verticals: ["property","contractors","general"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["property","general_liability","umbrella"],
    premium_range_min: 300, premium_range_max: 3000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Property/casualty. Coastal/specialty. NOT primary commercial auto. Strong in OH.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Branch",
    states: ["OH","TX","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","GA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["homeowners","small_business","contractors"],
    min_vehicles: 1, max_vehicles: 25, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["general_liability","property","umbrella"],
    premium_range_min: 250, premium_range_max: 2000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Digital-first homeowners/small commercial. NOT primary commercial auto. OH and TX strong.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "NationalSummit",
    states: ["TX","GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","OH","MI","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["trucking","construction","manufacturing","general"],
    min_vehicles: 1, max_vehicles: 100, max_vehicle_age: null,
    dui_lookback_months: 24, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: true, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","umbrella","workers_comp"],
    premium_range_min: 500, premium_range_max: 8000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "E&S/specialty. 2-year DUI lookback. TX and GA strong. Good for hard-to-place risks.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Commonwealth Auto Insurance",
    states: ["TX","OK","AR","LA","NM"],
    verticals: ["trucking","transportation","non_standard_auto"],
    min_vehicles: 1, max_vehicles: 25, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","non_standard_auto"],
    premium_range_min: 350, premium_range_max: 1800,
    instant_bind: false, quote_turnaround_hours: 24,
    notes: "Non-standard/specialty auto. 3-year DUI. TX only.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Premium by Intelliat",
    states: ["MI","OH","TX","GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["trucking","construction","contractors","general"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","workers_comp","umbrella"],
    premium_range_min: 400, premium_range_max: 4000,
    instant_bind: false, quote_turnaround_hours: 48,
    notes: "Broad appetite. 3-year DUI. Good for mixed commercial risks. Nationwide coverage.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Foremost",
    states: ["MI","OH","TX","GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["specialty","mobile_home","non_standard_auto","rv"],
    min_vehicles: 1, max_vehicles: 25, max_vehicle_age: 20,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","non_standard_auto","rv"],
    premium_range_min: 350, premium_range_max: 2000,
    instant_bind: false, quote_turnaround_hours: 24,
    notes: "Specialty/non-standard. Mobile homes, RVs. 3-year DUI. Max 25 units.",
    access_status: "active", source_panel: "smart_choice"
  },
  {
    carrier_name: "Adaptive",
    states: ["MI","OH","TX","GA","FL","NC","SC","TN","AL","MS","LA","AR","OK","KS","MO","NE","IA","MN","WI","IL","IN","KY","PA","NY","NJ","CT","RI","MA","NH","VT","ME","DE","MD","DC","WV","VA","CA","NV","UT","CO","NM","OR","WA","ID","MT","WY","ND","SD","HI","AK","AZ"],
    verticals: ["small_business","contractors","general"],
    min_vehicles: 1, max_vehicles: 50, max_vehicle_age: null,
    dui_lookback_months: 36, min_driver_age: 21, requires_cdl: false,
    hazmat_allowed: false, reefer_allowed: true, auto_hauler_allowed: false,
    sand_gravel_allowed: true, intermodal_allowed: true,
    min_revenue: 0, min_years_in_business: 1, requires_dot_number: false,
    requires_dashcam: false, requires_eld: false, accepts_owner_ops: true,
    lines: ["commercial_auto","general_liability","bop","property"],
    premium_range_min: 350, premium_range_max: 3000,
    instant_bind: true, quote_turnaround_hours: 2,
    notes: "Digital small business. Quick quotes. 3-year DUI. Good for contractors and small commercial.",
    access_status: "active", source_panel: "smart_choice"
  }
];

// ═══════════════════════════════════════════════════════════
// MATCHING ENGINE
// ═══════════════════════════════════════════════════════════

function matchCarriers({
  state,
  vertical = "trucking",
  vehicle_count = 1,
  vehicle_age,
  has_hazmat = false,
  has_dui = false,
  dui_months_ago,
  revenue = 0,
  years_in_business = 0,
  needs_reefer = true,
  needs_auto_hauler = false,
  needs_sand_gravel = true,
  access_filter = null  // 'active', 'request', 'panel', or null for all
}) {
  let matches = CARRIERS.filter(c => {
    // State match
    if (!c.states.includes(state?.toUpperCase())) return false;

    // Access status filter
    if (access_filter && c.access_status !== access_filter) return false;

    // Vertical match
    const vertMatch = c.verticals.includes(vertical) || c.verticals.includes("general");
    if (!vertMatch) return false;

    // Vehicle count
    if (vehicle_count < c.min_vehicles || vehicle_count > c.max_vehicles) return false;

    // Vehicle age
    if (vehicle_age && c.max_vehicle_age && vehicle_age > c.max_vehicle_age) return false;

    // Hazmat
    if (has_hazmat && !c.hazmat_allowed) return false;

    // DUI logic
    if (has_dui) {
      if (c.dui_lookback_months === null) return false;
      if (dui_months_ago && c.dui_lookback_months < dui_months_ago) return false;
    }

    // Revenue
    if (revenue && c.min_revenue && revenue < c.min_revenue) return false;

    // Years in business
    if (years_in_business && c.min_years_in_business && years_in_business < c.min_years_in_business) return false;

    // Reefer
    if (needs_reefer && !c.reefer_allowed) return false;

    // Auto hauler
    if (needs_auto_hauler && !c.auto_hauler_allowed) return false;

    // Sand/gravel
    if (needs_sand_gravel && !c.sand_gravel_allowed) return false;

    return true;
  });

  // Sort: instant bind first, then fastest quote
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
    if (c.instant_bind) reasons.push("Instant bind");
    if (c.quote_turnaround_hours <= 24) reasons.push("24hr quote");
    if (c.dui_lookback_months && has_dui && c.dui_lookback_months >= (dui_months_ago || 0)) reasons.push("DUI-friendly");
    if (c.hazmat_allowed && has_hazmat) reasons.push("Hazmat OK");
    if (c.min_revenue && revenue && c.min_revenue <= revenue) reasons.push("Revenue fit");
    if (c.access_status === "active") reasons.push("Ready to quote");
    return { ...c, match_reasons: reasons };
  });

  return {
    match_count: matches.length,
    instant_bind: instant,
    fast_turnaround: fast,
    standard: standard,
    top_pick: matches[0] || null,
    all_matches: withReasoning,
    disqualified_reason: matches.length === 0 ? "No carriers match this risk profile" : null
  };
}

function getCarrierNames(state, access_filter = "active") {
  return CARRIERS
    .filter(c => c.states.includes(state?.toUpperCase()) && (!access_filter || c.access_status === access_filter))
    .map(c => ({ name: c.carrier_name, status: c.access_status }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getTopCarriersForLead(lead) {
  const result = matchCarriers({
    state: lead.state,
    vertical: lead.industry || "trucking",
    vehicle_count: lead.vehicle_count || 1,
    has_hazmat: lead.hazmat || false,
    has_dui: lead.has_dui || false,
    dui_months_ago: lead.dui_months_ago || null,
    revenue: lead.revenue || 0,
    years_in_business: lead.years_in_business || 0,
    access_filter: "active"  // Only quote-ready carriers
  });

  const top3 = result.all_matches.slice(0, 3).map(c => c.carrier_name).join(", ");
  return { top3, fullData: result };
}

function getCarrierByName(name) {
  return CARRIERS.find(c => c.carrier_name.toLowerCase() === name.toLowerCase()) || null;
}

function getActiveCarrierCount() {
  return CARRIERS.filter(c => c.access_status === "active").length;
}

function getPanelSummary() {
  const panels = {};
  CARRIERS.forEach(c => {
    if (!panels[c.source_panel]) panels[c.source_panel] = { total: 0, active: 0, request: 0 };
    panels[c.source_panel].total++;
    panels[c.source_panel][c.access_status]++;
  });
  return panels;
}

module.exports = {
  CARRIERS,
  matchCarriers,
  getCarrierNames,
  getTopCarriersForLead,
  getCarrierByName,
  getActiveCarrierCount,
  getPanelSummary
};
