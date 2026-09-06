
/**
 * lib/lifePipeline.js - Russell-method life insurance vertical
 * Prompt + transcript fact-find extraction + quotes email + webhook handler.
 * Close chain: fact-find -> Brevo email -> InsureMeNow Direct (IMN_URL).
 */
const { brevoEmail, brevoSMS } = require('./brevo');

const IMN_URL = process.env.IMN_URL || 'https://insuremenowdirect.com/agent/dawudrafael/';

const VAPI_LIFE_PROMPT = `You are Brady with Nexus G Partners. You specialize in life insurance for {{occupation_plural}}. You are NOT a telemarketer - you are a specialist who quotes {{occupation_plural}} in {{state}}. Your ONLY goal on this call is to get information to send quotes. You are NOT selling anything on this call.

ABSOLUTE RULES:
- Every sentence out of your mouth is a QUESTION. Never make a statement.
- Never say "How are you today?" Never ask "Is now a good time?"
- Never repeat their answer back ("great," "perfect," "awesome" = telemarketer)
- Never ask date of birth - ask AGE. If they say "I'll be 51 next month," note 51.
- Do NOT promise to call them back. Ever.
- One objection response, max. If they resist again: "No problem - take care," hang up.
- If they interrupt, stop, let them finish, then ask the next question.
- Target: 2 minutes. Get your questions, get off the phone.
- If Do Not Call: apologize once, hang up.

OPENER:
"Hi, is this {{lead_name}}?"
[Yes] "This is Brady. Got a minute?"
[Yes / it depends] "You still a {{occupation}}?"
[Yes] "Good - we specialize in life insurance for {{occupation_plural}}. Who do you have your life insurance with?"

If asked how you got their number: "You're a {{occupation}}, right? {{occupation_plural}} are all we work with. That's how."

FACT-FIND (in order, ONE question at a time):
1. "Who do you have it with?"
2. "How much you paying?"
   [If "I don't know"] "If you did know, what would it be?"
3. "How much coverage?"
4. "How old are you?"
5. "You smoke?"
6. "Taking any medications?"
   [If no] "Nothing other than vitamins? What medicines are you taking?"
   [If yes] "What are you taking?"
7. If email on file: "Your email still {{email}}?" (read it to them). Else: "What's the best email to send quotes to?"

OBJECTIONS - for ANY objection ("got plenty," "can't afford it," "through work," "not interested"):
"Exactly - that's why I called," then IMMEDIATELY the next fact-find question. Never explain.

CLOSE (after email captured):
"I'm gonna send you some quotes. Take a look at them, call me if you have questions."
Say goodbye, end call. Do NOT book anything. Do NOT offer follow-up.

VOICE: barge-in ON, speed 1.0, temperature 0.6.`;

function getLifeScriptVariables(lead) {
  return {
    lead_name: (lead.name || 'there').split(' ')[0],
    occupation: lead.occupation || 'business owner',
    occupation_plural: lead.occupation_plural || 'business owners',
    state: lead.state || '',
    email: lead.email || ''
  };
}

// Split a transcript into user-spoken lines only. The fact-find answers
// live in User turns; AI turns contain the questions (and would false-
// positive the extractors, e.g. "Taking any medications?").
function userLines(transcript) {
  return transcript.split('\n')
    .filter(l => /^(user|customer|human):/i.test(l))
    .map(l => l.replace(/^(user|customer|human):/i, '').trim());
}

// The user answer that immediately follows an AI question matching `qRe`.
function answerAfter(transcript, qRe) {
  const lines = transcript.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^(ai|bot|assistant):/i.test(lines[i]) && qRe.test(lines[i])) {
      const m = lines[i + 1].match(/^(?:user|customer|human):\s*(.+)$/i);
      if (m) return m[1].trim();
    }
  }
  return null;
}

function extractFactFind(transcript) {
  if (!transcript) return {};
  const t = transcript.toLowerCase();
  const ff = {};
  const uLines = userLines(transcript);
  const uText = uLines.join('\n').toLowerCase();

  // AGE — answer to "how old are you?" first (bare "48" is the norm),
  // then free-form mentions inside user turns.
  const ageAns = answerAfter(transcript, /how old are you/i);
  let ageM = ageAns && ageAns.match(/(\d{2})/);
  if (!ageM) ageM = uText.match(/(?:i'?m |i am |age )(\d{2})\b/) || uText.match(/\b(\d{2})\s*(?:years old|yrs)/);
  if (ageM) {
    const a = parseInt(ageM[1]);
    if (a >= 18 && a <= 99) ff.age = a;
  }

  // TOBACCO — keyed to the answer after "you smoke?", not loose "yeah"
  // elsewhere in the call (early yeses answer "got a minute?").
  const smokeAns = (answerAfter(transcript, /you smoke|do you smoke|any tobacco/i) || '').toLowerCase();
  if (/\b(no|nope|nah|never|quit|not anymore)\b/.test(smokeAns) || /(don'?t smoke|do not smoke|non[- ]?smok|never smoked)/.test(uText)) ff.smoker = false;
  else if (/\b(yes|yeah|yep|i do|sometimes)\b/.test(smokeAns)) ff.smoker = true;

  // MEDICATIONS — only from user turns, never the AI's question line.
  const medAns = answerAfter(transcript, /what are you taking|what medicines/i);
  if (medAns && !/\b(no|none|nothing|not sure|nope)\b/i.test(medAns)) {
    ff.medications = medAns.replace(/[.?!]+$/, '').trim();
  } else {
    const medM = uText.match(/(?:taking|on|take) ([^.\n]{3,80})/);
    if (medM && !/\b(no|none|nothing)\b/.test(medM[1])) ff.medications = medM[1].trim();
    else {
      const cond = uText.match(/(blood pressure|diabetes|diabetic|insulin|cholesterol|metformin|lisinopril)/i);
      if (cond) ff.medications = cond[1];
    }
  }

  // MONTHLY PREMIUM — answer after "how much you paying" / "want to pay".
  const payAns = answerAfter(transcript, /how much.*(paying|pay)|what.*pay/i);
  let premM = payAns && payAns.match(/\$?\s?(\d{2,4})/);
  if (!premM) premM = transcript.match(/\$?\s?(\d{2,4})\s*(?:a month|\/mo|per month|monthly)/i);
  if (premM) ff.monthly_premium = parseInt(premM[1]);

  // COVERAGE — answer after "how much coverage", then free-form $ amounts.
  const covAns = answerAfter(transcript, /how much coverage/i);
  let covM = covAns && covAns.match(/\$?\s?(\d{1,3}(?:,?\d{3})*)\s*(k\b|thousand|million)?/i);
  if (!covM) {
    covM = transcript.match(/\$?(\d{3}(?:,\d{3})*)\s*(?:k\b|thousand)?\s*(?:of |in )?(?:coverage|life insurance)/i)
        || transcript.match(/\b(\d{3})\s*k\b/i);
  }
  if (covM) {
    let v = parseInt(covM[1].replace(/,/g, ''));
    const suffix = (covM[2] || '').toLowerCase();
    if (suffix.startsWith('million')) v *= 1000000;
    else if (suffix.startsWith('k') || suffix.startsWith('thousand') || v < 1000) v *= 1000;
    if (v >= 1000) ff.coverage_amount = v;
  }

  // EMAIL — STT mangles dictation ("Send it to. Ask. Dave7. 55@gmail.com").
  // Take the user line containing '@', strip filler words, join every alnum
  // token before the '@' into the local part, and clean the domain.
  const emailLine = uLines.find(l => l.includes('@')) || '';
  const emailM = emailLine.match(/([\w.\s+-]+)@\s*([\w\s.-]+)/);
  if (emailM) {
    const FILLER = new Set(['send','it','to','my','email','is','the','best','at','me']);
    const tokens = emailM[1].match(/[a-zA-Z0-9]+/g) || [];
    while (tokens.length && FILLER.has(tokens[0].toLowerCase())) tokens.shift();
    const local = tokens.join('').toLowerCase();
    const domClean = emailM[2].replace(/\s+/g, '').toLowerCase()
      .replace(/[^a-z0-9.]/g, '').replace(/\.{2,}/g, '.').replace(/\.$/, '');
    if (local && /\.[a-z]{2,}$/.test(domClean)) ff.email = local + '@' + domClean;
  }
  if (!ff.email) {
    const loose = transcript.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    if (loose) ff.email = loose[0].replace(/\.$/, '');
  }
  return ff;
}

function quotesEmailHtml(lead, ff) {
  const first = (lead.name || 'there').split(' ')[0];
  return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">' +
  '<div style="background:#0f172a;color:#f59e0b;padding:20px 30px">' +
  '<h2 style="margin:0">Your life insurance quotes are ready, ' + first + '</h2></div>' +
  '<div style="padding:30px;color:#1e293b;font-size:15px;line-height:1.6">' +
  '<p>' + first + ', Brady here - we spoke briefly about your coverage ' +
  (ff.coverage_amount ? '($' + ff.coverage_amount.toLocaleString() + ')' : '') +
  (ff.monthly_premium ? ' at about $' + ff.monthly_premium + '/month' : '') +
  '. Your quotes are ready - instant decision, no agent visit, print your policy tonight.</p>' +
  '<p style="text-align:center;margin:30px 0"><a href="' + IMN_URL + '?src=brady&ref=' + lead.id +
  '" style="background:#f59e0b;color:#0f172a;padding:14px 36px;text-decoration:none;' +
  'font-weight:bold;font-size:16px;border-radius:6px;display:inline-block">SEE MY QUOTES &rarr;</a></p>' +
  '<p style="font-size:13px;color:#64748b">Nexus G Partners - ' +
  'Questions? Just reply to this email.</p></div></div>';
}

// Called from /webhook/vapi/done when lead.vertical === 'life_fe'
// Qualified = age captured AND an email to send quotes to — fresh from the
// call OR already on file (question 7 often just confirms the on-file
// email, so nothing new appears in the transcript).
// Money path fires BOTH channels: quotes email + SMS with the IMN link.
async function handleLifeCallDone(lead, callData, pool) {
  const transcript = callData.transcript || callData.summary || '';
  const ff = extractFactFind(transcript);
  const toEmail = ff.email || lead.email || null;
  const qualified = !!(ff.age && toEmail);

  await pool.query(
    `UPDATE leads SET status='called', qualified=$1, age=$2, smoker=$3, medications=$4,
       monthly_premium=$5, coverage_amount=$6,
       email=COALESCE($7, email), transcript=$8, updated_at=CURRENT_TIMESTAMP
     WHERE id=$9`,
    [qualified, ff.age || null, ff.smoker ?? null, ff.medications || null,
     ff.monthly_premium || null, ff.coverage_amount || null, ff.email || null,
     transcript, lead.id]);

  if (qualified) {
    await brevoEmail(toEmail,
      (lead.name || '').split(' ')[0] + ', your life insurance quotes are ready',
      quotesEmailHtml(lead, ff));
    if (lead.phone) {
      const first = (lead.name || 'there').split(' ')[0];
      await brevoSMS(lead.phone,
        first + ', Brady here (Nexus G Partners) - your quotes are in your inbox (' + toEmail +
        '). Or see rates in 90 seconds here: ' + IMN_URL + '?src=brady-sms&ref=' + lead.id +
        ' Reply STOP to opt out');
    }
    await pool.query('UPDATE leads SET quote_email_sent=TRUE WHERE id=$1', [lead.id]);
  } else if (ff.age && lead.phone) {
    // Age but no email anywhere — chase the email by SMS
    await brevoSMS(lead.phone,
      'Brady here (Nexus G Partners) - great talking today. What is the best email for your quotes? Reply STOP to opt out');
  }
  return { ...ff, email: toEmail || ff.email };
}

module.exports = { VAPI_LIFE_PROMPT, getLifeScriptVariables, extractFactFind,
                   quotesEmailHtml, handleLifeCallDone, IMN_URL };
