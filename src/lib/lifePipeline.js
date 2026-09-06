
/**
 * lib/lifePipeline.js - Russell-method life insurance vertical
 * Prompt + transcript fact-find extraction + quotes email + webhook handler.
 * Close chain: fact-find -> Brevo email -> InsureMeNow Direct (IMN_URL).
 */
const { brevoEmail, brevoSMS } = require('./brevo');

const IMN_URL = process.env.IMN_URL || 'https://insuremenowdirect.com/agent/dawudrafael/';

const VAPI_LIFE_PROMPT = `You are Brady with Smart Choice Agents. You specialize in life insurance for {{occupation_plural}}. You are NOT a telemarketer - you are a specialist who quotes {{occupation_plural}} in {{state}}. Your ONLY goal on this call is to get information to send quotes. You are NOT selling anything on this call.

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

function extractFactFind(transcript) {
  if (!transcript) return {};
  const t = transcript.toLowerCase();
  const ff = {};
  const ageM = t.match(/(?:i'?m |age |i am )(\d{2})\b/) || t.match(/\b(\d{2})\s*(?:years old|yrs)/);
  if (ageM) ff.age = parseInt(ageM[1]);
  if (/(don'?t smoke|do not smoke|non[- ]?smok|never smoked)/.test(t)) ff.smoker = false;
  else if (/\b(smoke|smoker|vape|chew|tobacco)\b/.test(t) && /(yes|yeah|i do)/.test(t)) ff.smoker = true;
  const medM = transcript.match(/taking ([^.\n]{3,80})/i);
  if (medM) ff.medications = medM[1].trim();
  const premM = transcript.match(/\$?\s?(\d{2,4})\s*(?:a month|\/mo|per month|monthly)/i);
  if (premM) ff.monthly_premium = parseInt(premM[1]);
  const covM = transcript.match(/\$?(\d{3}(?:,\d{3})*)\s*(?:k\b|thousand)?\s*(?:of |in )?(?:coverage|life insurance)/i)
            || transcript.match(/\b(\d{3})\s*k\b/i);
  if (covM) {
    let v = parseInt(covM[1].replace(/,/g, ''));
    if (v < 1000) v *= 1000;
    ff.coverage_amount = v;
  }
  const emailM = transcript.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (emailM) ff.email = emailM[0];
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
  '<p style="font-size:13px;color:#64748b">Smart Choice Agents - Licensed in 20 states - ' +
  'Questions? Just reply to this email.</p></div></div>';
}

// Called from /webhook/vapi/done when lead.vertical === 'life_fe'
async function handleLifeCallDone(lead, callData, pool) {
  const transcript = callData.transcript || callData.summary || '';
  const ff = extractFactFind(transcript);

  await pool.query(
    `UPDATE leads SET status='called', qualified=$1, age=$2, smoker=$3, medications=$4,
       monthly_premium=$5, coverage_amount=$6,
       email=COALESCE($7, email), transcript=$8, updated_at=CURRENT_TIMESTAMP
     WHERE id=$9`,
    [!!(ff.email && ff.age), ff.age || null, ff.smoker ?? null, ff.medications || null,
     ff.monthly_premium || null, ff.coverage_amount || null, ff.email || null,
     transcript, lead.id]);

  if (ff.email && ff.age) {
    await brevoEmail(ff.email,
      (lead.name || '').split(' ')[0] + ', your life insurance quotes are ready',
      quotesEmailHtml(lead, ff));
    await pool.query('UPDATE leads SET quote_email_sent=TRUE WHERE id=$1', [lead.id]);
  } else if (ff.age && lead.phone) {
    await brevoSMS(lead.phone,
      'Brady here (Smart Choice) - great talking today. What is the best email for your quotes? Reply STOP to opt out');
  }
  return ff;
}

module.exports = { VAPI_LIFE_PROMPT, getLifeScriptVariables, extractFactFind,
                   quotesEmailHtml, handleLifeCallDone, IMN_URL };
