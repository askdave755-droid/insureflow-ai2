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

async function makeCall(lead) {
  const { getNaturalOpener, getCarrierMention, calculateUrgency } = require('./validate');
  
  const variables = {
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
    industry_focus: config.STATE_CONFIG[lead.state]?.vertical || 'commercial_auto'
  };

  try {
    const response = await vapiClient.post('/call', {
      assistantId: config.VAPI_ASSISTANT_ID,
      phoneNumberId: config.VAPI_PHONE_NUMBER_ID,
      customer: {
        number: lead.phone,
        name: lead.name
      },
      assistantOverrides: {
        variableValues: variables
      }
    });

    return {
      success: true,
      callId: response.data.id,
      cost: response.data.cost || 0
    };
  } catch (error) {
    console.error('Vapi call failed:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { makeCall };
