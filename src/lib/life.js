// ═══════════════════════════════════════════════
// LIFE VERTICAL — Russell-method 2-minute fact-find
// Small-biz owners (occupation from HasData Maps Categories)
// → Vapi fact-find → Brevo SMS/email → InsureMeNow close
// ═══════════════════════════════════════════════

const axios = require('axios');
const config = require('../config');

// ─── OPENERS ───
// Life angle: business owner protecting family + business.
// No renewal hook (life has no X-date) — lead with occupation context.
function getLifeOpener(lead) {
  const firstName = (lead.name || 'there').split(' ')[0];
  const occupation = lead.occupation || lead.industry || lead.title || null;
  const company = lead.company || null;

  const occLine = occupation
    ? `I work with a lot of ${occupation} owners${company ? ` like ${company}` : ''}`
    : company ? `I work with a lot of owners like ${company}` : 'I work with a lot of small business owners';

  const openers = [
    `Hey ${firstName}, it's Brady with Nexus G Partners. ${occLine} — quick question, if something happened to you tomorrow, is your family covered or does everything fall on them?`,
    `${firstName}, Brady here, Nexus G Partners. ${occLine}, and most of them have the business insured but forgot the person who runs it. Got 2 minutes?`,
    `Hey ${firstName}, it's Brady. ${occLine} — I'm doing quick 2-minute coverage checkups this week. When's the last time someone looked at your life insurance?`
  ];
  return openers[Math.floor(Math.random() * openers.length)];
}

// ─── FACT-FIND EXTRACTION ───
// Russell method: age, tobacco, health, coverage goal, dependents, budget.
// Deterministic extraction from transcript/summary — no external AI call.
function extractLifeFactFind(transcript = '', summary = '') {
  const text = `${summary}\n${transcript}`;
  const lower = text.toLowerCase();
  const ff = {};

  // Age: "I'm 45" / "45 years old" / "age 45"
  let m = lower.match(/(?:i'?m|i am|age[d]?|about)\s*(\d{2})\s*(?:years? old|y\/?o)?/) ||
          lower.match(/\b(\d{2})\s*(?:years? old|y\/?o)\b/);
  if (m) {
    const age = parseInt(m[1], 10);
    if (age >= 18 && age <= 85) ff.age = age;
  }

  // Tobacco / nicotine
  if (/\b(non[- ]?smoker|don'?t smoke|no tobacco|never smoked|quit (?:smoking|tobacco))\b/.test(lower)) {
    ff.tobacco = false;
  } else if (/\b(smoker|smoke|tobacco|cigarettes?|vape|vaping|chew)\b/.test(lower)) {
    ff.tobacco = true;
  }

  // Health flags (rate-class killers)
  const flags = [];
  if (/\bdiabet/.test(lower)) flags.push('diabetes');
  if (/\b(heart|cardiac|stent|bypass)\b/.test(lower)) flags.push('heart');
  if (/\b(high blood pressure|hypertension|bp meds?)\b/.test(lower)) flags.push('blood_pressure');
  if (/\bcancer\b/.test(lower)) flags.push('cancer');
  if (/\b(copd|sleep apnea)\b/.test(lower)) flags.push('respiratory');
  if (flags.length) ff.healthFlags = flags;
  if (/\b(pretty healthy|no health|healthy|clean bill)\b/.test(lower) && !flags.length) {
    ff.healthFlags = [];
  }

  // Coverage goal: "$500k" / "half a million" / "a million" / "250,000"
  m = lower.match(/\$?\s*(\d+(?:\.\d+)?)\s*(?:k|thousand)\b/);
  if (m) ff.coverageGoal = Math.round(parseFloat(m[1]) * 1000);
  if (!ff.coverageGoal) {
    m = lower.match(/\b(half a million|a half million)\b/);
    if (m) ff.coverageGoal = 500000;
  }
  if (!ff.coverageGoal) {
    m = lower.match(/\b(?:a |one |two |three )?million\b/);
    if (m) {
      const mult = /two/.test(m[0]) ? 2 : /three/.test(m[0]) ? 3 : 1;
      ff.coverageGoal = mult * 1000000;
    }
  }
  if (!ff.coverageGoal) {
    m = lower.match(/\$\s*(\d{1,3}),?(\d{3})\b/);
    if (m) ff.coverageGoal = parseInt(m[1] + m[2], 10);
  }

  // Dependents: "3 kids" / "two kids and my wife"
  m = lower.match(/\b(\d+|one|two|three|four|five|six)\s*(?:kids?|children)\b/);
  if (m) {
    const word = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    ff.dependents = word[m[1]] || parseInt(m[1], 10);
  }
  if (/\b(wife|husband|spouse)\b/.test(lower)) ff.hasSpouse = true;

  // Existing coverage
  if (/\b(no coverage|don'?t have (any|life)|nothing|no life insurance|not covered)\b/.test(lower)) {
    ff.existingCoverage = 'none';
  } else if (/\b(through (my |the )?(work|job|employer)|group life|work policy)\b/.test(lower)) {
    ff.existingCoverage = 'employer_group';
  } else if (/\b(have (a|some) (policy|coverage|life)|already have|current policy)\b/.test(lower)) {
    ff.existingCoverage = 'own_policy';
  }

  // Budget: "$50 a month" / "hundred bucks"
  m = lower.match(/\$\s*(\d{2,4})\s*(?:a|per|\/)?\s*month/);
  if (m) ff.monthlyBudget = parseInt(m[1], 10);

  // Email capture (Vapi often normalizes in summary)
  m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (m) ff.email = m[0].toLowerCase();

  return ff;
}

// Fact-find completeness: Russell method needs age + tobacco + coverage goal
// minimum to quote; everything else sharpens the class.
function factFindScore(ff) {
  let score = 0;
  if (ff.age) score += 25;
  if (ff.tobacco !== undefined) score += 20;
  if (ff.coverageGoal) score += 25;
  if (ff.healthFlags !== undefined) score += 10;
  if (ff.existingCoverage) score += 10;
  if (ff.monthlyBudget) score += 5;
  if (ff.dependents !== undefined || ff.hasSpouse) score += 5;
  return Math.min(score, 100);
}

// ─── QUALIFICATION ───
// A life lead is qualified when: interested/booked disposition AND
// we captured enough fact-find to quote (score >= 50).
function analyzeLifeCall({ transcript = '', summary = '', successEvaluation, duration = null }) {
  const { detectDisposition } = require('./qualify');
  const disposition = detectDisposition({ transcript, summary, successEvaluation, duration });
  const factFind = extractLifeFactFind(transcript, summary);
  const ffScore = factFindScore(factFind);
  const interested = ['booked', 'interested'].includes(disposition);
  const qualified = interested && ffScore >= 50;
  return { disposition, qualified, factFind, ffScore };
}

// ─── FOLLOW-UP MESSAGING (Brevo) ───
async function sendLifeFollowUp(lead, factFind) {
  const { sendSMS, sendEmail } = require('./messaging');
  const prisma = require('../db');
  const firstName = (lead.name || 'there').split(' ')[0];
  const link = config.INSUREMENOW_LINK;

  const covText = factFind.coverageGoal
    ? `$${factFind.coverageGoal.toLocaleString()} in coverage`
    : 'the right coverage';

  // US toll-free: STOP language required
  const smsBody = `${firstName}, Brady from Nexus G Partners. Based on our call, you can see real rates for ${covText} in about 90 seconds here: ${link} Reply STOP to opt out.`;
  await sendSMS(lead.phone, smsBody);

  const toEmail = factFind.email || lead.email;
  if (toEmail) {
    const rows = [
      factFind.age && `Age: ${factFind.age}`,
      factFind.tobacco !== undefined && `Tobacco: ${factFind.tobacco ? 'Yes' : 'No'}`,
      factFind.coverageGoal && `Coverage goal: $${factFind.coverageGoal.toLocaleString()}`,
      factFind.dependents && `Dependents: ${factFind.dependents}`,
      factFind.existingCoverage && `Current coverage: ${factFind.existingCoverage.replace(/_/g, ' ')}`
    ].filter(Boolean).map(r => `<li style="margin:4px 0;">${r}</li>`).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#1e293b;">Hi ${firstName},</h2>
        <p>Good talking with you today. Here's what I noted:</p>
        <ul style="color:#334155;">${rows}</ul>
        <p>You can see real, no-obligation rates in about 90 seconds:</p>
        <a href="${link}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;">See My Rates</a>
        <p style="margin-top:24px;font-size:13px;color:#64748b;">Brady | Nexus G Partners</p>
      </div>
    `;
    await sendEmail(toEmail, `Your life insurance rates are ready, ${firstName}`, html,
      `Hi ${firstName}, see your rates here: ${link}`);
  }

  // Mark quote email sent (feeds /api/life/stats `emailed` column)
  try {
    await prisma.lead.update({ where: { id: lead.id }, data: { quoteEmailSent: true } });
  } catch (e) {
    console.warn('⚠️ quote_email_sent flag failed:', e.message);
  }
}

module.exports = {
  getLifeOpener,
  extractLifeFactFind,
  factFindScore,
  analyzeLifeCall,
  sendLifeFollowUp
};
