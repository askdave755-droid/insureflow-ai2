/**
 * brevo.js - Brevo (Sendinblue) transactional email + SMS.
 * Env: BREVO_API_KEY, BREVO_SENDER (verified sender email), BREVO_SMS_SENDER (SMS sender, e.g. +18665056792)
 */
const axios = require('axios');

const API_KEY = process.env.BREVO_API_KEY;
const SENDER = process.env.BREVO_SENDER || 'noreply@example.com';
const SMS_SENDER = process.env.BREVO_SMS_SENDER || 'Brady';

function formatPhone(phone) {
  const d = String(phone).replace(/\D/g, '');
  return d.startsWith('1') ? '+' + d : '+1' + d;
}

async function brevoEmail(to, subject, html) {
  if (!API_KEY || !to) return null;
  try {
    const r = await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender: { name: 'Brady - Smart Choice Agents', email: SENDER },
      to: [{ email: to }],
      subject,
      htmlContent: html
    }, { headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' } });
    console.log('Brevo email ->', to);
    return r.data;
  } catch (e) {
    console.error('Brevo email failed:', e.response?.data || e.message);
    return null;
  }
}

async function brevoSMS(phone, text) {
  if (!API_KEY || !phone) return null;
  try {
    const r = await axios.post('https://api.brevo.com/v3/transactionalSMS/sms', {
      sender: SMS_SENDER,
      recipient: formatPhone(phone),
      content: text,
      type: 'transactional'
    }, { headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' } });
    console.log('Brevo SMS ->', phone);
    return r.data;
  } catch (e) {
    console.error('Brevo SMS failed:', e.response?.data || e.message);
    return null;
  }
}

module.exports = { brevoEmail, brevoSMS, formatPhone };
