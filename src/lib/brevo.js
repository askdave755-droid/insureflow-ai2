/**
 * lib/brevo.js - Email + SMS via Brevo (replaces SendGrid + TextMagic)
 * Env: BREVO_API_KEY, BREVO_SENDER (verified domain required)
 */
const axios = require('axios');

const API_KEY = process.env.BREVO_API_KEY;
const SENDER = process.env.BREVO_SENDER || 'brady@yourdomain.com';

function formatPhone(p) {
  if (!p) return p;
  let d = String(p).replace(/\D/g, '');
  if (d.length === 10) d = '1' + d;
  return '+' + d;
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
      sender: 'Brady',
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
