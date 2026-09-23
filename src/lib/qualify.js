// ═══════════════════════════════════════════════
// CALL INTELLIGENCE + AI QUALIFICATION (Phase 3)
// Deterministic extraction from Vapi end-of-call reports:
// disposition, qualification, and risk-data capture.
// Fast, predictable, testable — no external AI calls.
// ═══════════════════════════════════════════════

const DISPOSITIONS = ['booked', 'interested', 'callback', 'not_interested', 'dnc', 'no_answer', 'completed', 'unknown'];

const NUMBER_WORDS = new Set([
  'zero', 'oh', 'o', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'
]);

// Voicemail greetings and phone-tree prompts arrive as "User:" lines in the
// Vapi transcript, so they must be filtered before intent matching. Otherwise
// "press one", "we will call you back", or the assistant's own voicemail drop
// can turn a machine pickup into an unknown/completed-looking call.
const AUTOMATED_PATTERNS = [
  /\bsorry (?:i|we) missed you\b/i,
  /\bwe'?ll try (?:you |them )?(?:back|again)\b/i,
  /\bleave (?:me |us )?(?:a |your |the )?(?:message|voicemail|voice mail)\b/i,
  /\bleave (?:your )?(?:name|number|phone number)\b/i,
  /\brecord (?:your |a |the )?message\b/i,
  /\bafter the (?:tone|beep)\b/i,
  /\bat the (?:tone|beep)\b/i,
  /\bwhen (?:you'?re|you have) finished recording\b/i,
  /\bpress (?:or say )?(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|pound|star|hash)\b/i,
  /\bhash key\b/i,
  /\bparty'?s extension\b/i,
  /\blisten carefully\b/i,
  /\bmenu options?\b/i,
  /\bfollowing \w+ options\b/i,
  /\bcall may be (?:recorded|monitored)\b/i,
  /\bmessage (?:is )?too short\b/i,
  /\bmailbox is full\b/i,
  /\bto (?:replay|review|rerecord|re-record|continue recording|delete|cancel|send) (?:this |your |the )?message\b/i,
  /\bto (?:mark|add to) (?:this |your |the )?message\b/i,
  /\bto leave (?:a |your )?(?:callback number|message)\b/i,
  /\bdelivery options\b/i,
  /\bsend an sms notification\b/i,
  /\byour message has been sent\b/i,
  /\bmessage sent\b/i,
  /\bplease stay on the line\b/i,
  /\bplease hold\b/i,
  /\bcall is being transferred\b/i,
  /\bwhile your call is transferred\b/i,
  /\bwe understand you called\b/i,
  /\bunable to (?:take|answer) (?:your )?call\b/i,
  /\byou'?ve reached\b.*\b(?:voicemail|voice mail|mailbox)\b/i,
  /\bi'?ll (?:get back|return your call|call you back)\b/i,
  /\bwe will (?:get back|return your call|call you back)\b/i,
  /\bas soon as (?:possible|i can|we can)\b/i,
  /\bat (?:our|my) earliest convenience\b/i,
  /\bthank(?:s| you) for calling\b/i,
  /\bplease hang up\b/i,
  /\byou may hang up\b/i,
  /\bmay hang up\b/i,
  /\bhang up (?:or|when|to)\b/i,
  /\bleaving (?:a |your )?message\b/i,
  /\bwhen leaving (?:a |your )?message\b/i,
  /\bspeak clearly\b/i,
  /\bfor a quicker response\b/i,
  /\bplease feel free to reach (?:me|us)\b/i,
  /\bthis person is not available\b/i,
  /\bnot available right now\b/i,
  /\bif at any time\b/i,
  /\bto dial by name\b/i,
  /\bto transfer to (?:voice mail|voicemail)\b/i,
  /\bto repeat this menu\b/i,
  /\bgive you a shout back\b/i,
  /\bhave a great day\b/i,
  /\bgoodbye\b/i
];

const GENERIC_ACK = /^(?:hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|bye|goodbye|okay|ok|um|uh|yes|yeah|yep)[.!\s]*$/i;
const SHORT_REFUSAL = /^(?:no|nope|nah|no thanks|not interested|hang up|wrong number)[.!\s]*$/i;
const REPEATED_REFUSAL = /^(?:no[.!\s]*){2,}(?:thanks[.!\s]*)?$/i;

function normalizeSpeech(line) {
  return String(line || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTranscriptBySpeaker(transcript) {
  const user = [];
  const assistant = [];
  let sawLabels = false;
  let currentRole = null;

  for (const raw of String(transcript || '').split(/\r?\n/)) {
    const m = raw.match(/^\s*(user|human|customer|prospect|ai|assistant|bot|agent)\s*:\s*(.*)$/i);
    if (m) {
      sawLabels = true;
      currentRole = /^(user|human|customer|prospect)$/i.test(m[1]) ? 'user' : 'assistant';
      const line = m[2].trim();
      if (line) (currentRole === 'user' ? user : assistant).push(line);
    } else if (sawLabels && raw.trim() && currentRole) {
      // Vapi occasionally wraps a long utterance onto the next line.
      const bucket = currentRole === 'user' ? user : assistant;
      if (bucket.length) bucket[bucket.length - 1] += ' ' + raw.trim();
    }
  }

  return { sawLabels, user, assistant };
}

function isAutomatedLine(line) {
  const text = normalizeSpeech(line);
  return !!text && AUTOMATED_PATTERNS.some(re => re.test(text));
}

function isDigitsOnly(line) {
  const words = normalizeSpeech(line).replace(/[.,!?()-]/g, ' ').split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every(w => /^\d+$/.test(w) || NUMBER_WORDS.has(w));
}

function isHumanLine(line) {
  const text = normalizeSpeech(line);
  return !!text && !isAutomatedLine(text) && !isDigitsOnly(text);
}

function isSubstantiveHumanLine(line) {
  const text = normalizeSpeech(line);
  if (!isHumanLine(text) || GENERIC_ACK.test(text)) return false;
  const words = text.match(/[a-z]+(?:'[a-z]+)?/g) || [];
  return words.length >= 3 || SHORT_REFUSAL.test(text);
}

function detectDisposition({ transcript = '', summary = '', successEvaluation, duration = null }) {
  const speakers = splitTranscriptBySpeaker(transcript);
  const humanLines = speakers.sawLabels ? speakers.user.filter(isHumanLine) : [];
  const humanText = humanLines.join('\n');
  const intentText = `${summary}\n${speakers.sawLabels ? humanText : transcript}`.toLowerCase();
  const allText = `${summary}\n${transcript}`.toLowerCase();

  // DNC first — a verbal opt-out overrides everything else on the call.
  // This is matched only against human/summary text so a phone-tree privacy
  // prompt cannot accidentally suppress a lead.
  if (/(do not call|don't call|stop calling|quit calling|remove me (from|off)|take me off|opt.?out|never call (me|us|here))/.test(intentText)) {
    return 'dnc';
  }

  const booked = /(book(ed|ing)?|schedul(e|ed|ing)|appointment|calendar invite|sent (you |the )?(a |the )?link|set up (a|the) (call|meeting|time)|see you (then|on))/.test(intentText);
  const success = successEvaluation && String(successEvaluation).toLowerCase().includes('success');
  if (booked || success) return 'booked';

  if (/(call (me|us) back|give (me|us) a call back|try (me|us) (again|later)|not a good time|not right now|busy right now|in a meeting|driving right now|better (time|day)|another time|tomorrow|next (week|month)|after (the )?renewal|reach me later)/.test(intentText)) {
    return 'callback';
  }

  if (/(not interested|no thanks|happy with (our|my|the) (current |)(agent|carrier|broker)|all set|we'?re good|just renewed|already (have|covered|taken care)|wrong number|hang up|walk off|talk to a real person|still a computer)/.test(intentText)
      || /\bno\b[\s\S]{0,80}\bgoodbye\b/.test(intentText)
      || /^no\.\s*it'?s\s+(?:\d+|six|seven|eight|nine|ten)\s+o'?clock/.test(normalizeSpeech(humanLines[0] || ''))
      || humanLines.some(l => SHORT_REFUSAL.test(normalizeSpeech(l)) || REPEATED_REFUSAL.test(normalizeSpeech(l)))) {
    return 'not_interested';
  }

  if (/(interested|send (me |over )?(the |some |that |it )?(info|information|details|quote)|email (me|it|that|over)|get (me |us )?a quote|quote me|shop (it|my|our|the)|compare|save (me |us )?(some )?money|cheaper|better rate|what do you need|how much would|my renewal|our renewal|renews? in)/.test(intentText)) {
    return 'interested';
  }

  const automated = AUTOMATED_PATTERNS.some(re => re.test(allText));
  const automatedUserLines = speakers.user.filter(isAutomatedLine).length;
  const substantiveHumanLines = humanLines.filter(isSubstantiveHumanLine).length;
  const hasSubstantiveHuman = substantiveHumanLines > 0;
  const substantiveSummary = String(summary || '').trim().length >= 80
    && !/(voicemail|voice mail|no answer|left a message|phone tree|ivr)/i.test(summary);

  // A machine pickup with no real prospect response is a retryable no-answer,
  // even when the transcript is long because the phone tree repeated itself.
  // Two+ automated utterances with at most one ambiguous human fragment are
  // still a phone tree; multiple substantive human lines mean a real handoff
  // happened after the menu (e.g. receptionist picked up).
  if ((automated && !hasSubstantiveHuman)
      || (automatedUserLines >= 2 && substantiveHumanLines < 2)
      || (speakers.sawLabels && humanLines.length === 0)) {
    return 'no_answer';
  }

  // Short call with no substance = voicemail / no pickup / immediate hangup.
  if (!hasSubstantiveHuman && !substantiveSummary && (duration === null || duration < 45)) {
    return 'no_answer';
  }

  // A real conversation happened but no money/action phrase was captured.
  // Keep it out of "unknown" so follow-up can route it to review/nurture.
  if (hasSubstantiveHuman || substantiveSummary || (duration !== null && duration >= 45)) {
    return 'completed';
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
  let m = text.match(new RegExp(String.raw`(?:renew\w*|expir\w*|due|comes? up|lapse\w*)[^.!?]{0,40}?(${monthNames})(?:\s+(\d{1,2})(?:st|nd|rd|th)?)?(?:,?\s*(\d{4}))?`, 'i'));
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
    const carrierPattern = c.split(' ').join(String.raw`\s`);
    const re = new RegExp(String.raw`\b${carrierPattern}(?:\s+insurance)?\b`, 'i');
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
