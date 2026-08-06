const axios = require('axios');
const sgMail = require('@sendgrid/mail');
const config = require('../config');
const prisma = require('../db');

if (config.SENDGRID_API_KEY) {
  sgMail.setApiKey(config.SENDGRID_API_KEY);
}

async function sendSMS(phone, message, leadId) {
  try {
    const response = await axios.post(
      'https://rest.textmagic.com/api/v2/messages',
      {
        phones: phone,
        text: message
      },
      {
        auth: {
          username: config.TEXTMAGIC_USERNAME,
          password: config.TEXTMAGIC_API_KEY
        }
      }
    );
    
    await prisma.cost.create({
      data: { leadId, type: 'sms', amount: 0.01, description: 'TextMagic SMS' }
    });
    
    return { success: true, messageId: response.data.id };
  } catch (error) {
    console.error('SMS failed:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
}

async function sendQualificationEmail(lead) {
  if (!lead.email || !config.SENDGRID_API_KEY) return { success: false };
  
  const stateCfg = config.STATE_CONFIG[lead.state];
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a1a;">
      <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); padding: 30px; text-align: center;">
        <h1 style="color: #fff; margin: 0; font-size: 24px;">Smart Choice Agents</h1>
        <p style="color: #e0e0e0; margin: 10px 0 0;">Commercial Insurance Specialists</p>
      </div>
      
      <div style="padding: 30px; background: #fff;">
        <p style="font-size: 18px; margin-bottom: 20px;">Hi ${lead.name.split(' ')[0]},</p>
        
        <p>Brady here from Smart Choice. Just wrapped up our call about <strong>${lead.company || 'your business'}</strong>'s ${stateCfg?.vertical.replace('_', ' ') || 'commercial'} policy.</p>
        
        <p>As discussed, I'm running your current coverage against ${stateCfg?.carriers || 'our top carriers'} to find savings. Most ${lead.state} businesses in your space are overpaying by 20-30% this renewal cycle.</p>
        
        <div style="background: #f8f9fa; border-left: 4px solid #2d5a87; padding: 20px; margin: 25px 0;">
          <p style="margin: 0; font-size: 16px;"><strong>Next Step:</strong> 15-minute comparison call</p>
          <p style="margin: 8px 0 0; color: #666;">I'll need your current dec page to run accurate numbers.</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${config.CALENDLY_LINK}" 
             style="background: #2d5a87; color: #fff; padding: 15px 40px; text-decoration: none; border-radius: 5px; font-size: 16px; display: inline-block;">
            Book My Comparison Call
          </a>
        </div>
        
        <p style="color: #666; font-size: 14px;">If the link doesn't work, reply here or text me back. I'll get you sorted.</p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px; text-align: center;">
          Smart Choice Agents | Licensed in 20 States<br>
          This email was sent because you requested a quote during our phone conversation.
        </p>
      </div>
    </div>
  `;
  
  try {
    await sgMail.send({
      to: lead.email,
      from: config.EMAIL_FROM,
      subject: `${lead.company || 'Your Business'} - Insurance Comparison Ready`,
      html,
      text: `Hi ${lead.name.split(' ')[0]},\n\nBrady here from Smart Choice. Ready to run your numbers against ${stateCfg?.carriers}.\n\nBook 15 minutes: ${config.CALENDLY_LINK}\n\n-Brady`
    });
    
    await prisma.cost.create({
      data: { leadId: lead.id, type: 'email', amount: 0.0001, description: 'SendGrid email' }
    });
    
    return { success: true };
  } catch (error) {
    console.error('Email failed:', error.message);
    return { success: false, error: error.message };
  }
}

async function handleQualifiedLead(lead) {
  const results = [];
  
  // SMS immediately
  const smsText = `Brady here from Smart Choice. Great talking about ${lead.company || 'your business'} today. Book your 15-min comparison here: ${config.CALENDLY_LINK}`;
  const sms = await sendSMS(lead.phone, smsText, lead.id);
  results.push({ channel: 'sms', ...sms });
  
  // Email 2 minutes later
  if (lead.email) {
    setTimeout(async () => {
      const email = await sendQualificationEmail(lead);
      results.push({ channel: 'email', ...email });
    }, 120000);
  }
  
  return results;
}

module.exports = { sendSMS, sendQualificationEmail, handleQualifiedLead };
