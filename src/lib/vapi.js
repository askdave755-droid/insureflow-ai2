// ============================================
// VAPI OUTBOUND CALLING
// Multi-vertical: each vertical gets its own assistant
// AND its own phone number (separate caller IDs).
// commercial_auto -> VAPI_ASSISTANT_ID / VAPI_PHONE_NUMBER_ID
// life_fe         -> VAPI_LIFE_ASSISTANT_ID / VAPI_LIFE_PHONE_NUMBER_ID
// ============================================

const axios = require('axios');
const config = require('../config');

const vapiClient = axios.create({
  baseURL: 'https://api.vapi.ai',
  headers: {
    Authorization: `Bearer ${config.VAPI_API_KEY}`,
    'Content-Type': 'application/json'
  },
  timeout: 10000
});

const ASSISTANTS = {
  commercial_auto: {
    assistant: process.env.VAPI_ASSISTANT_ID,
    phone:     process.env.VAPI_PHONE_NUMBER_ID
  },
  life_fe: {
    assistant: process.env.VAPI_LIFE_ASSISTANT_ID,
    // Falls back to the commercial number if no dedicated life number yet
    phone:     process.env.VAPI_LIFE_PHONE_NUMBER_ID || process.env.VAPI_PHONE_NUMBER_ID
  }
};

// A lead is life-vertical if explicitly tagged life_fe OR legacy-tagged
// via insuranceType starting with "life".
function leadVertical(lead) {
  if (lead.vertical && ASSISTANTS[lead.vertical]) return lead.vertical;
  if ((lead.insuranceType || '').toLowerCase().startsWith('life')) return 'life_fe';
  return 'commercial_auto';
}

function isLifeLead(lead) {
  return leadVertical(lead) === 'life_fe';
}

function commercialVariables(lead) {
  const { getNaturalOpener, getCarrierMention, calculateUrgency } = require('./validate');
  return {
    lead_name: lead.name.split(' ')[0],
    full_name: lead.name,
    company: lead.company || 'your business',
    title: lead.title || 'business owner',
    insurance_type: lead.insuranceType,
    calendly_link: config.CALENDLY_LINK,
    natural_opener: getNaturalOpener(lead),
    urgency_phrase: calculateUrgency(lead.xDate),
    carrier_mention: getCarrierMention(lead),
    state_context: config.STATE_CONFIG[lead.state]?.opener || '',
    authority_line: `I'm handling the renewal for ${lead.company}`,
    urgency_close: `Worth a 2-minute comparison or are you locked in?`,
    price_anchor: lead.revenue > 2000000 ? '$2,000-5,000' : '$800-1,500',
    time_commitment: '4 minutes',
    wc_available: config.STATE_CONFIG[lead.state]?.wcAvailable ? 'true' : 'false',
    state: lead.state,
    industry_focus: config.STATE_CONFIG[lead.state]?.vertical || 'commercial_auto',
    lead_email: lead.email || ''
  };
}

// Life variables — original script variables from lib/lifePipeline.js
// (lead_name, occupation, occupation_plural, state, email) plus the
// InsureMeNow Direct link used by the close chain.
function lifeVariables(lead) {
  const { getLifeScriptVariables, IMN_URL } = require('./lifePipeline');
  return {
    ...getLifeScriptVariables(lead),
    full_name: lead.name,
    company: lead.company || 'your business',
    occupation: lead.occupation || lead.industry || lead.title || 'business owner',
    insuremenow_link: config.INSUREMENOW_LINK || IMN_URL,
    time_commitment: '2 minutes'
  };
}

// PATCH 3: callback intro — used when the make-call job carries {type:'callback'}
const ASSISTANT_NAME = process.env.VAPI_ASSISTANT_NAME || 'Brady';
function callbackIntro(lead, vertical) {
  const first = (lead.name || 'there').split(' ')[0];
  const product = vertical === 'life_fe' ? 'life insurance'
    : (lead.insuranceType || 'commercial auto').replace(/_/g, ' ');
  return `Hi ${first}, this is ${ASSISTANT_NAME} from Nexus — you asked us to call you back about ${product}.`;
}

async function makeCall(lead, opts = {}) {
  const vertical = leadVertical(lead);
  const cfg = ASSISTANTS[vertical] || ASSISTANTS.commercial_auto;
  const variables = vertical === 'life_fe' ? lifeVariables(lead) : commercialVariables(lead);
  const isCallback = opts.type === 'callback';
  const firstMessage = isCallback ? callbackIntro(lead, vertical) : undefined;
  if (isCallback) {
    variables.natural_opener = firstMessage;
    variables.call_type = 'callback';
  }

  try {
    const response = await vapiClient.post('/call', {
      assistantId: cfg.assistant,
      phoneNumberId: cfg.phone,
      customer: {
        number: lead.phone,
        // VAPI rejects customer names over 40 chars — scraped business
        // names ("Detroit Barber Co. Barbershop & Brand - ...") blow past it.
        name: (lead.name || '').slice(0, 40)
      },
      assistantOverrides: {
        variableValues: variables,
        ...(firstMessage ? { firstMessage } : {})
      }
    });

    return {
      success: true,
      callId: response.data.id,
      cost: response.data.cost || 0,
      vertical
    };
  } catch (error) {
    console.error('Vapi call failed:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { makeCall, isLifeLead, leadVertical, ASSISTANTS, callbackIntro };
