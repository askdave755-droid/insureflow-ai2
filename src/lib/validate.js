const { parsePhoneNumber } = require('libphonenumber-js');
const { DateTime } = require('luxon');
const { STATE_CONFIG, CALL_HOURS } = require('../config');

function formatPhoneE164(phone) {
  try {
    const parsed = parsePhoneNumber(phone, 'US');
    if (!parsed || !parsed.isValid()) return null;
    return parsed.format('E.164');
  } catch {
    return null;
  }
}

function isBusinessHours(state) {
  const tz = STATE_CONFIG[state]?.timezone || 'America/New_York';
  const now = DateTime.now().setZone(tz);
  const hour = now.hour;
  
  // No calls before 7AM or after 8PM
  if (hour < CALL_HOURS.start || hour >= CALL_HOURS.end) return false;
  
  // No Sunday calls
  if (now.weekday === 7) return false;
  
  return true;
}

function getNextBusinessTime(state) {
  const tz = STATE_CONFIG[state]?.timezone || 'America/New_York';
  let dt = DateTime.now().setZone(tz);
  
  // If after hours, move to 7AM tomorrow
  if (dt.hour >= CALL_HOURS.end) {
    dt = dt.plus({ days: 1 }).set({ hour: CALL_HOURS.start, minute: 0 });
  } else if (dt.hour < CALL_HOURS.start) {
    dt = dt.set({ hour: CALL_HOURS.start, minute: 0 });
  }
  
  // Skip Sunday
  if (dt.weekday === 7) dt = dt.plus({ days: 1 }).set({ hour: CALL_HOURS.start });
  
  return dt.toJSDate();
}

function isQualified(transcript = '') {
  if (!transcript) return false;
  const text = transcript.toLowerCase();
  const keywords = ['book', 'schedule', 'interested', 'quote', 'yes', 'appointment', 'call me back', 'send info'];
  return keywords.some(k => text.includes(k));
}

function calculateUrgency(xDate) {
  if (!xDate) return 'soon';
  const renewal = new Date(xDate);
  const today = new Date();
  const days = Math.ceil((renewal - today) / (1000 * 60 * 60 * 24));
  
  if (days < 0) return 'recently';
  if (days < 7) return 'next week';
  if (days < 14) return 'in two weeks';
  if (days < 30) return 'next month';
  return `on ${renewal.toLocaleDateString()}`;
}

function getCarrierMention(lead) {
  const stateCfg = STATE_CONFIG[lead.state];
  const industry = (lead.industry || '').toLowerCase();
  const naics = lead.naicsCode || '';
  
  if (industry.includes('truck') || industry.includes('transport') || naics.startsWith('484')) {
    return 'Cover Whale for your fleet, plus The Hartford for the liability package';
  }
  if (industry.includes('construct') || naics.startsWith('238')) {
    return 'The Hartford and AmTrust—they specialize in contractors';
  }
  if (industry.includes('manufacturing') || naics.startsWith('336')) {
    return 'CNA and The Hartford—strong manufacturing programs';
  }
  if (lead.revenue > 5000000 || lead.employeeCount > 50) {
    return 'CNA, The Hartford, and Chubb for larger operations';
  }
  
  return stateCfg?.carriers || 'The Hartford and CNA';
}

function getNaturalOpener(lead) {
  const name = lead.name.split(' ')[0];
  const company = lead.company || 'your business';
  const stateCfg = STATE_CONFIG[lead.state];
  
  const openers = [
    `Hey ${name}, it's Brady. I saw ${company}'s policy coming up for renewal...`,
    `${name}, Brady here. Real quick—who handles the insurance shopping over there at ${company}?`,
    `Hi ${name}, Brady with Smart Choice. I'm calling because ${company}'s commercial policy is expiring soon, and I found something that might save you money...`,
    `${name}, it's Brady. I'm working with a few ${lead.industry || 'business'} owners in ${lead.state || 'the area'} on their renewals. Are you handling that for ${company}?`,
    `Hey ${name}, Brady. Quick question—you got 30 seconds? I'm looking at ${company}'s policy expiring ${calculateUrgency(lead.xDate)}...`
  ];
  
  return openers[Math.floor(Math.random() * openers.length)];
}

module.exports = {
  formatPhoneE164,
  isBusinessHours,
  getNextBusinessTime,
  isQualified,
  calculateUrgency,
  getCarrierMention,
  getNaturalOpener
};
