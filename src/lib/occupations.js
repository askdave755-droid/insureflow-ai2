/**
 * lib/occupations.js - Google Maps category -> pitch niche (Russell specialty line)
 * Usage: detectOccupation(row.type, row.description) -> {singular, plural}
 * Add niches freely - one line each, no prompt changes needed.
 */
const OCCUPATION_MAP = {
  'barber':             { singular: 'barber',                  plural: 'barbers' },
  'barbershop':         { singular: 'barber',                  plural: 'barbers' },
  'beauty salon':       { singular: 'salon owner',             plural: 'salon owners' },
  'hair salon':         { singular: 'salon owner',             plural: 'salon owners' },
  'nail salon':         { singular: 'nail salon owner',        plural: 'nail salon owners' },
  'landscap':           { singular: 'landscaper',              plural: 'landscapers' },
  'lawn':               { singular: 'lawn care owner',         plural: 'lawn care owners' },
  'real estate':        { singular: 'realtor',                 plural: 'realtors' },
  'real estate agency': { singular: 'realtor',                 plural: 'realtors' },
  'trucking':           { singular: 'trucker',                 plural: 'truckers' },
  'plumb':              { singular: 'plumber',                 plural: 'plumbers' },
  'electric':           { singular: 'electrician',             plural: 'electricians' },
  'hvac':               { singular: 'HVAC contractor',         plural: 'HVAC contractors' },
  'roof':               { singular: 'roofer',                  plural: 'roofers' },
  'restaurant':         { singular: 'restaurant owner',        plural: 'restaurant owners' },
  'tattoo':             { singular: 'tattoo artist',           plural: 'tattoo artists' },
  'gym':                { singular: 'gym owner',               plural: 'gym owners' },
  'personal trainer':   { singular: 'trainer',                 plural: 'trainers' },
  'clean':              { singular: 'cleaning business owner', plural: 'cleaning business owners' },
  'construct':          { singular: 'contractor',              plural: 'contractors' },
  'bakery':             { singular: 'baker',                   plural: 'bakers' },
  'auto repair':        { singular: 'auto shop owner',         plural: 'auto shop owners' },
  'dentist':            { singular: 'dentist',                 plural: 'dentists' },
  'day care':           { singular: 'daycare owner',           plural: 'daycare owners' },
  'child care':         { singular: 'daycare owner',           plural: 'daycare owners' }
};

function detectOccupation(categories, description = '') {
  const haystack = ((categories || '') + ' ' + (description || '')).toLowerCase();
  for (const [key, occ] of Object.entries(OCCUPATION_MAP)) {
    if (haystack.includes(key)) return occ;
  }
  return { singular: 'business owner', plural: 'business owners' };
}

module.exports = { OCCUPATION_MAP, detectOccupation };
