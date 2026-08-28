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
  // PENDING RENEWAL (expired 07/31/2026 — late-renew on NIPR):
  // TX: { script: 'aggressive_business', priority: true, vertical: 'commercial_auto', carriers: 'Cover Whale, Nirvana, and RT Connector', opener: 'Texas businesses need protection from liability risks', wcAvailable: true, tone: 'direct', timezone: 'America/Chicago' },
  // GA: { script: 'port_trucking', priority: true, vertical: 'commercial_auto', carriers: 'Cover Whale and Nirvana', opener: 'Atlanta and Savannah port trucking is booming', wcAvailable: true, tone: 'friendly', timezone: 'America/New_York' },
  // AL: { script: 'manufacturing_growth', priority: false, vertical: 'commercial_auto', carriers: 'Cover Whale and RT Connector', opener: 'Alabama manufacturing is growing fast', wcAvailable: true, tone: 'friendly', timezone: 'America/Chicago' },
  // UNVERIFIED LICENSE STATUS:
  // OH: { script: 'rust_belt_mfg', priority: true, vertical: 'commercial_auto', carriers: 'Cover Whale, Nirvana, and Forge', opener: 'Ohio manufacturing has specific insurance needs', wcAvailable: true, tone: 'consultative', timezone: 'America/New_York' },
  // IN: { script: 'logistics_corridor', priority: true, vertical: 'commercial_auto', carriers: 'Cover Whale, Nirvana, and Forge', opener: 'Indiana logistics corridor means fleet growth', wcAvailable: true, tone: 'friendly', timezone: 'America/Indiana/Indianapolis' }
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
  // Shared secret Vapi sends with webhooks (set in Assistant → Server URL
  // secret header). If unset, webhook auth logs a warning and allows (dev).
  VAPI_WEBHOOK_SECRET: process.env.VAPI_WEBHOOK_SECRET,

  BREVO_API_KEY: process.env.BREVO_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  CALENDLY_LINK: process.env.CALENDLY_LINK,
  // Shared secret for Brevo inbound webhooks (fail-closed in production).
  BREVO_WEBHOOK_SECRET: process.env.BREVO_WEBHOOK_SECRET,

  // Phase 1 tenancy — default client for legacy null-clientId rows/requests.
  DEFAULT_CLIENT_ID: process.env.DEFAULT_CLIENT_ID,
  DEFAULT_CLIENT_SLUG: process.env.DEFAULT_CLIENT_SLUG,

  // Nuclear reset guard — /admin/nuclear-reset refuses unless exactly 'true'.
  ALLOW_NUCLEAR_RESET: process.env.ALLOW_NUCLEAR_RESET,

  // Instantly AI — insurance-agent client acquisition ONLY (not prospect dialing).
  INSTANTLY_API_KEY: process.env.INSTANTLY_API_KEY,
  INSTANTLY_API_BASE_URL: process.env.INSTANTLY_API_BASE_URL || 'https://api.instantly.ai/api/v1',
  INSTANTLY_WEBHOOK_SECRET: process.env.INSTANTLY_WEBHOOK_SECRET,
  // Outbound push to Instantly stays OFF unless explicitly set to 'true'.
  INSTANTLY_PUSH_ENABLED: process.env.INSTANTLY_PUSH_ENABLED || 'false',

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
