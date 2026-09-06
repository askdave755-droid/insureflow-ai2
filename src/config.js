require('dotenv').config();

// LICENSED LAUNCH STATES ONLY (verified via First Connect portal Aug 2026):
// MI (resident), AZ (business entity), TN, FL — all Active with P&C authority.
// TX/GA/AL expired 07/31/2026 — late-renew on NIPR, then uncomment below.
// OH/IN unverified — uncomment only after confirming Active status.
const STATE_CONFIG = {
  MI: {
    script: 'mfg_focus',
    priority: true,
    vertical: 'commercial_auto_wc',
    carriers: 'Cover Whale, Nirvana, and Forge',
    opener: 'Michigan manufacturing has unique risks with workers comp rates',
    wcAvailable: true,
    tone: 'consultative',
    timezone: 'America/Detroit'
  },
  AZ: {
    script: 'retirement_construction',
    priority: true,
    vertical: 'fe_commercial',
    carriers: 'Cover Whale and RT Connector',
    opener: 'Arizona construction boom means coverage gaps',
    wcAvailable: false,
    tone: 'relaxed',
    timezone: 'America/Phoenix'
  },
  TN: {
    script: 'freight_logistics',
    priority: true,
    vertical: 'commercial_auto',
    carriers: 'Cover Whale and Nirvana',
    opener: 'Memphis is the freight capital — coverage gaps everywhere',
    wcAvailable: true,
    tone: 'friendly',
    timezone: 'America/Chicago'
  },
  FL: {
    script: 'port_logistics',
    priority: true,
    vertical: 'commercial_auto',
    carriers: 'Diesel Insurance and RT Connector',
    opener: 'Florida port and logistics trucking is booming',
    wcAvailable: true,
    tone: 'friendly',
    timezone: 'America/New_York'
  }
};

const ALLOWED_STATES = Object.keys(STATE_CONFIG);
const CALL_HOURS = { start: 7, end: 20 }; // 7AM - 8PM

module.exports = {
  PORT: process.env.PORT || 8080,
  BASE_URL: process.env.BASE_URL,
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,

  VAPI_API_KEY: process.env.VAPI_API_KEY,
  VAPI_ASSISTANT_ID: process.env.VAPI_ASSISTANT_ID,
  VAPI_PHONE_NUMBER_ID: process.env.VAPI_PHONE_NUMBER_ID,
  VAPI_WEBHOOK_SECRET: process.env.VAPI_WEBHOOK_SECRET,

  // ─── LIFE VERTICAL (Sept 2026) ───
  // Separate Vapi assistant running the Russell-method 2-min fact-find.
  VAPI_LIFE_ASSISTANT_ID: process.env.VAPI_LIFE_ASSISTANT_ID,
  // Where qualified life leads close themselves (quote/buy link).
  INSUREMENOW_LINK: process.env.INSUREMENOW_LINK || 'https://www.insuremenow.com',
  // HasData Google Maps Categories scraper (occupation-sourced life leads).
  HASDATA_API_KEY: process.env.HASDATA_API_KEY,

  BREVO_API_KEY: process.env.BREVO_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  CALENDLY_LINK: process.env.CALENDLY_LINK,

  APOLLO_API_KEY: process.env.APOLLO_API_KEY,
  FMCSA_API_KEY: process.env.FMCSA_API_KEY,

  LEO_SFTP_HOST: process.env.LEO_SFTP_HOST,
  LEO_SFTP_USER: process.env.LEO_SFTP_USER,
  LEO_SFTP_PASS: process.env.LEO_SFTP_PASS,

  PHANTOM_WEBHOOK_SECRET: process.env.PHANTOM_WEBHOOK_SECRET,
  PHANTOM_API_KEY: process.env.PHANTOM_API_KEY,

  STATE_CONFIG,
  ALLOWED_STATES,
  CALL_HOURS
};
