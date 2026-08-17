require('dotenv').config();

const STATE_CONFIG = {
  MI: {
    script: 'mfg_focus',
    priority: true,
    vertical: 'commercial_auto_wc',
    carriers: 'The Hartford, CNA, and AmTrust',
    opener: 'Michigan manufacturing has unique risks with workers comp rates',
    wcAvailable: true,
    tone: 'consultative',
    timezone: 'America/Detroit'
  },
  AZ: {
    script: 'retirement_construction',
    priority: true,
    vertical: 'fe_commercial',
    carriers: 'The Hartford and Progressive',
    opener: 'Arizona construction boom means coverage gaps',
    wcAvailable: false,
    tone: 'relaxed',
    timezone: 'America/Phoenix'
  },
  TX: {
    script: 'aggressive_business',
    priority: true,
    vertical: 'commercial_auto',
    carriers: 'Burns & Wilcox, CRC, and The Hartford',
    opener: 'Texas businesses need protection from liability risks',
    wcAvailable: true,
    tone: 'direct',
    timezone: 'America/Chicago'
  },
  OH: {
    script: 'rust_belt_mfg',
    priority: true,
    vertical: 'commercial_auto',
    carriers: 'GUARD, Liberty Mutual, and The Hartford',
    opener: 'Ohio manufacturing has specific insurance needs',
    wcAvailable: true,
    tone: 'consultative',
    timezone: 'America/New_York'
  },
  AL: {
    script: 'manufacturing_growth',
    priority: false,
    vertical: 'commercial_auto',
    carriers: 'Cover Whale and Progressive',
    opener: 'Alabama manufacturing is growing fast',
    wcAvailable: true,
    tone: 'friendly',
    timezone: 'America/Chicago'
  },
  TN: {
    script: 'freight_logistics',
    priority: true,
    vertical: 'commercial_auto',
    carriers: 'The Hartford and Progressive',
    opener: 'Memphis is the freight capital — coverage gaps everywhere',
    wcAvailable: true,
    tone: 'friendly',
    timezone: 'America/Chicago'
  },
  GA: {
    script: 'port_trucking',
    priority: true,
    vertical: 'commercial_auto',
    carriers: 'The Hartford and Progressive',
    opener: 'Atlanta and Savannah port trucking is booming',
    wcAvailable: true,
    tone: 'friendly',
    timezone: 'America/New_York'
  },
  IN: {
    script: 'logistics_corridor',
    priority: true,
    vertical: 'commercial_auto',
    carriers: 'The Hartford and Progressive',
    opener: 'Indiana logistics corridor means fleet growth',
    wcAvailable: true,
    tone: 'friendly',
    timezone: 'America/Indiana/Indianapolis'
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
  
  TEXTMAGIC_USERNAME: process.env.TEXTMAGIC_USERNAME,
  TEXTMAGIC_API_KEY: process.env.TEXTMAGIC_API_KEY,
  
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
  BREVO_API_KEY: process.env.BREVO_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,
  CALENDLY_LINK: process.env.CALENDLY_LINK,
  
  APOLLO_API_KEY: process.env.APOLLO_API_KEY,
  FMCSA_API_KEY: process.env.FMCSA_API_KEY,
  
  LEO_SFTP_HOST: process.env.LEO_SFTP_HOST,
  LEO_SFTP_USER: process.env.LEO_SFTP_USER,
  LEO_SFTP_PASS: process.env.LEO_SFTP_PASS,
  
  PHANTOM_WEBHOOK_SECRET: process.env.PHANTOM_WEBHOOK_SECRET,
  
  STATE_CONFIG,
  ALLOWED_STATES,
  CALL_HOURS
};
