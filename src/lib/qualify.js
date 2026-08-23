// ═══════════════════════════════════════════════
// CALL INTELLIGENCE + AI QUALIFICATION (Phase 3)
// Deterministic extraction from Vapi end-of-call reports:
// disposition, qualification, and risk-data capture.
// Fast, predictable, testable — no external AI calls.
// ═══════════════════════════════════════════════

const DISPOSITIONS = ['booked', 'interested', 'callback', 'not_interested', 'dnc', 'no_answer', 'unknown'];

function detectDisposition({ transcript = '', summary = '', successEvaluation, duration = null }) {
  const text = `${summary}\n${transcript}`.toLowerCase();

  // DNC first — a verbal opt-out overrides everything else on the call
  if (/(do not call|don't call|stop calling|remove me (from|off)|take me off|opt.?out|never call (me|us|here))/.test(text)) {
    return 'dnc';
  }

  const booked = /(book(ed|ing)?|schedul(e|ed|ing)|appointment|calendar invite|sent (you |the )?(a |the )?link|set up (a|the) (call|meeting|time)|see you (then|on))/.test(text);
  const success = successEvaluation && String(successEvaluation).toLowerCase().includes('success');
  if (booked || success) return 'booked';

  if (/(call (me |us )?back|try (me |us )?(again|later)|not a good time|busy right now|in a meeting|driving right now|next (week|month)|after (the )?renewal)/.test(text)) {
    return 'callback';
  }

  if (/(not interested|no thanks|happy with (our|my|the) (current |)(agent|carrier|broker)|all set|we'?re good|just renewed|already (have|covered|taken care))/.test(text)) {
    return 'not_interested';
  }

  if (/(interested|send (me |over )?(the |some |that )?(info|information|details|quote)|email (me|it|that|over)|get (me |us )?a quote|shop (it|my|our|the)|compare|save (me |us )?(some )?money|cheaper|better rate)/.test(text)) {
    return 'interested';
  }

  // Short call with no substance = voicemail / no pickup / IVR
  if ((!transcript || transcript.trim().length < 40) && (duration === null || duration < 30)) {
    return 'no_answer';
  }

  return 'unknown';
}

const QUALIFY_DISPOSITIONS = new Set(['booked', 'interested']);
function isQualifiedDisposition(disposition) {
  return QUALIFY_DISPOSITIONS.has(disposition);
}

const KNOWN_CARRIERS = [
  'progressive', 'geico', 'sentry', 'canal', 'northland', 'great west',
  'national interstate', 'liberty mutual', 'travelers', 'hartford',
  'cover whale', 'coverwhale', 'nirvana', 'occidental', 'arrowhead',
  'state farm', 'berkshire', 'bi berk', 'acuity', 'cna', 'zurich',
  'old republic', 'lyndon southern', 'empower', 'great american',
  'acceptance', 'gainsco', 'dairyland', 'bristol west'
];

function titleCase(s) {
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};

// Best-effort X-date extraction from natural speech:
// "renews in March", "expires October 1st", "due in about 6 weeks"
function renewalHintToDate(text) {
  const monthNames = Object.keys(MONTHS).join('|');
  let m = text.match(new RegExp(`(?:renew\\w*|expir\\w*|due|comes? up|lapse\\w*)[^.!?]{0,40}?(${monthNames})(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?)?(?:,?\\s*(\\d{4}))?`, 'i'));
  if (m) {
    const now = new Date();
    const month = MONTHS[m[1].toLowerCase()];
    let year = m[3] ? parseInt(m[3], 10) : now.getUTCFullYear();
    const day = m[2] ? parseInt(m[2], 10) : 1;
    if (!m[3] && month < now.getUTCMonth()) year += 1; // month already passed -> next year
    return new Date(Date.UTC(year, month, day));
  }
  m = text.match(/(?:renew\w*|expir\w*|due|comes? up)[^.!?]{0,25}?in\s+(?:about\s+|around\s+)?(\d{1,2})\s*(weeks?|months?)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    const days = m[2].toLowerCase().startsWith('week') ? n * 7 : n * 30;
    return new Date(Date.now() + days * 86400000);
  }
  return null;
}

// Pull structured risk/contact data out of what the prospect actually said.
// Only returns fields we positively extracted — caller merges non-null only.
function extractCallIntel(transcript = '', summary = '') {
  const text = `${summary}\n${transcript}`;
  const lower = text.toLowerCase();
  const out = {};

  let m = lower.match(/(\d{1,3})\s*(?:trucks?|power units?|semis?|tractors?|box trucks?|vehicles?|units?)/);
  if (m) out.vehicleCount = parseInt(m[1], 10);

  m = lower.match(/(\d{1,3})\s*drivers?/);
  if (m) out.driverCount = parseInt(m[1], 10);

  for (const c of KNOWN_CARRIERS) {
    const re = new RegExp(`\\b${c.replace(/ /g, '\\s')}(?:\\s+insurance)?\\b`, 'i');
    if (re.test(text)) { out.currentCarrier = titleCase(c); break; }
  }

  const xDate = renewalHintToDate(lower);
  if (xDate && !Number.isNaN(xDate.getTime())) out.xDate = xDate;

  // Email spoken on the call rarely transcribes cleanly, but Vapi often
  // normalizes it in the summary — grab anything shaped like an address.
  m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (m) out.email = m[0].toLowerCase();

  return out;
}

// One-call entry point used by the call worker.
function analyzeCall({ transcript = '', summary = '', successEvaluation, duration = null }) {
  const disposition = detectDisposition({ transcript, summary, successEvaluation, duration });
  const intel = extractCallIntel(transcript, summary);
  const qualified = isQualifiedDisposition(disposition);
  return { disposition, qualified, intel };
}

module.exports = {
  DISPOSITIONS,
  detectDisposition,
  isQualifiedDisposition,
  extractCallIntel,
  analyzeCall
};
