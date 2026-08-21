// ============================================
// SMS / EMAIL MESSAGING - BREVO ONLY
// src/lib/messaging.js
// Nexus G Partners branding (replaces Smart Choice)
// ============================================

const axios = require('axios');

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'askdave755@gmail.com';
const CALENDLY_LINK = process.env.CALENDLY_LINK;

// ─── BREVO SMS ───
async function sendSMS(to, message) {
  if (!BREVO_API_KEY) {
    console.error('❌ BREVO_API_KEY not set');
    return null;
  }
  try {
    const formatted = to.startsWith('+') ? to : `+1${to.replace(/\D/g, '')}`;
    const response = await axios.post(
      'https://api.brevo.com/v3/transactionalSMS/sms',
      {
        sender: 'NexusG',
        recipient: formatted,
        content: message,
        type: 'transactional'
      },
      {
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Brevo SMS sent: ${response.data.reference}`);
    return response.data;
  } catch (error) {
    console.error('❌ Brevo SMS failed:', error.response?.data || error.message);
    return null;
  }
}

// ─── BREVO EMAIL ───
async function sendEmail(to, subject, html, text) {
  if (!BREVO_API_KEY) {
    console.error('❌ BREVO_API_KEY not set');
    return null;
  }
  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: 'Brady @ Nexus G Partners', email: EMAIL_FROM },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text
      },
      {
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ Brevo email sent: ${response.data.messageId}`);
    return response.data;
  } catch (error) {
    console.error('❌ Brevo email failed:', error.response?.data || error.message);
    return null;
  }
}

// ─── QUALIFICATION FOLLOW-UP ───
async function sendQualificationFollowUp(lead, carrierNames) {
  const firstName = lead.name?.split(' ')[0] || 'there';
  const company = lead.company || 'your business';

  // Carrier-compliant: express verbal consent captured on the call, STOP language required for US toll-free/10DLC
  const smsBody = `${firstName}, Brady here from Nexus G Partners. I found options for ${company} through ${carrierNames}. Grab a time: ${CALENDLY_LINK} Reply STOP to opt out.`;
  await sendSMS(lead.phone, smsBody);

  if (lead.email) {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#1e293b;">Hi ${firstName},</h2>
        <p>Thanks for chatting with me about ${company}'s commercial insurance.</p>
        <p>I've identified the best carriers for your risk profile: <strong>${carrierNames}</strong>.</p>
        <p>Let's lock in a 15-minute comparison:</p>
        <a href="${CALENDLY_LINK}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Book My Call</a>
        <p style="margin-top:24px;font-size:13px;color:#64748b;">Brady | Nexus G Partners</p>
      </div>
    `;
    await sendEmail(lead.email, `Insurance options ready for ${company}`, html, `Hi ${firstName}, I've identified carriers for ${company}: ${carrierNames}. Book here: ${CALENDLY_LINK}`);
  }
}

// ─── BACKWARD COMPATIBILITY ───
// Existing callers still import the old export names:
//   routes.js            -> sendEmailBrevo (used by GET /test-email)
//   workers/callWorker.js -> handleQualifiedLead (the qualified-lead money path)
// Keep them working on top of the Brevo functions above.

const { getTopCarriersForLead } = require('./carriers');

// Old signature: sendEmailBrevo(lead, subject, html, text)
async function sendEmailBrevo(lead, subject, html, text) {
  const result = await sendEmail(lead.email, subject, html, text);
  if (!result) throw new Error('Brevo email failed — check BREVO_API_KEY and logs');
  return result;
}

// Old signature: handleQualifiedLead(lead)
// Carrier-aware: names the top 3 matched carriers in the SMS + email.
async function handleQualifiedLead(lead) {
  let carrierNames = 'our top carriers';
  try {
    const { top3 } = getTopCarriersForLead(lead);
    if (top3) carrierNames = top3;
  } catch (err) {
    console.warn('⚠️ Carrier match failed, using generic follow-up:', err.message);
  }
  return sendQualificationFollowUp(lead, carrierNames);
}

module.exports = {
  sendSMS,
  sendEmail,
  sendQualificationFollowUp,
  sendEmailBrevo,      // compat: routes.js /test-email
  handleQualifiedLead  // compat: workers/callWorker.js
};
