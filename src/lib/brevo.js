/**
 * brevo.js - Brevo (Sendinblue) transactional email + SMS.
 * SMS: uses Twilio when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_SMS_FROM are set,
 *      otherwise falls back to Brevo transactional SMS (requires Brevo SMS addon).
 * Env: BREVO_API_KEY, BREVO_SENDER (verified sender email), BREVO_SMS_SENDER,
 *      TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM (e.g. +17744973446)
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

async function twilioSMS(phone, text) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_FROM;
  if (!sid || !token || !from) return undefined; // not configured
  try {
    const body = new URLSearchParams({ To: formatPhone(phone), From: from, Body: text });
    const r = await axios.post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      body.toString(), {
        auth: { username: sid, password: token },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
    console.log('Twilio SMS ->', phone, r.data.sid);
    return r.data;
  } catch (e) {
    console.error('Twilio SMS failed:', e.response?.data || e.message);
    return null;
  }
}

async function brevoSMS(phone, text) {
  if (!phone) return null;
  const viaTwilio = await twilioSMS(phone, text);
  if (viaTwilio !== undefined) return viaTwilio; // Twilio configured: use it, win or lose
  if (!API_KEY) return null;
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

module.exports = { brevoEmail, brevoSMS, twilioSMS, formatPhone };
