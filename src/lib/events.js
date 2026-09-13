/**
 * events.js — InsureFlow event handlers (trucking pipeline spec).
 *
 *   quoteCreated       VAPI log_quote        -> quote record + discovery, opt-in confirm SMS
 *   quoteIssued        quote firmed          -> enroll quote_followup_v1 (day 0/2/5/9/14)
 *   appointmentBooked  VAPI book_time        -> calendar hold task, SMS confirm, VAPI callback
 *   policyBound        manual / carrier hook -> stop follow-up, bound track, cross-sell enroll,
 *                                               policy + renewal (+320d task), agent SMS
 *   crosssellConsented VAPI log_cross_sell   -> sub-deal task/opportunity, agent SMS
 *   callDnc            VAPI dnc / STOP reply -> hard suppression + stop all sequences
 *   followupReply      Brevo inbound webhook -> stop automation, agent SMS, hot task
 *
 * Agent alert phone: AGENT_ALERT_PHONE env (defaults to Dave's line).
 */

const prisma = require('../db');
const { brevoSMS } = require('./brevo');
const { addToDnc } = require('./compliance');
const seq = require('./sequences');
const { callQueue } = require('../queue');
const { createTask } = require('./followup');

const AGENT_PHONE = process.env.AGENT_ALERT_PHONE || '+17608581333';

function plusDays(days) {
  return new Date(Date.now() + days * 86400000);
}

// ── quote.created (VAPI log_quote) ──
async function quoteCreated(lead, data = {}) {
  // Attach discovery answers: onto a new quote record if the lead has
  // an opportunity; otherwise append to compliance notes so nothing is lost.
  let quoteRecord = null;
  if (data.premium || data.discovery) {
    const opp = await prisma.opportunity.findFirst({
      where: { leadId: lead.id }, orderBy: { createdAt: 'desc' }
    });
    if (opp) {
      const sub = await prisma.submission.create({
        data: { opportunityId: opp.id, carrier: data.carrier || 'TBD', status: 'DRAFT' }
      });
      quoteRecord = await prisma.quote.create({
        data: {
          submissionId: sub.id,
          carrier: data.carrier || 'TBD',
          premium: data.premium || null,
          coverageJson: data.discovery || null
        }
      });
    } else if (data.discovery) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { complianceNotes: '[discovery] ' + JSON.stringify(data.discovery).slice(0, 1500) }
      });
    }
  }

  let confirmSms = false;
  if (data.sms_optin) {
    await brevoSMS(lead.phone,
      (lead.name || 'there').split(' ')[0] + ' - David Hughes Insurance. Got it, your quote is confirmed and being finalized. This thread is monitored - reply any time. - David Hughes, David Hughes Insurance');
    confirmSms = true;
  }
  console.log(`📝 quote.created: ${lead.name} (quote: ${quoteRecord ? quoteRecord.id : 'none'}, confirm SMS: ${confirmSms})`);
  return { quoteId: quoteRecord ? quoteRecord.id : null, confirmSms };
}

// ── quote.issued (rate firmed — starts the follow-up engine) ──
async function quoteIssued(lead, data = {}) {
  await prisma.lead.update({ where: { id: lead.id }, data: { status: 'quoted' } });

  const expiry = data.expiry_date
    ? String(data.expiry_date)
    : plusDays(30).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });

  const merge = {
    premium_range: data.premium_range || 'your quoted rate',
    coverage_summary: data.coverage_summary || 'your coverage',
    business_class: data.business_class || lead.occupation || lead.industry || 'your class',
    moved_direction: data.moved_direction || 'held steady',
    expiry_date: expiry,
    vertical_branch: data.vertical_branch
      || (lead.vertical === 'life_fe' ? 'life_fe' : 'commercial_general')
  };

  const enr = await seq.enroll(lead, 'quote_followup_v1', merge, { force: data.force === true });
  console.log(`📨 quote.issued: ${lead.name} -> quote_followup_v1 (${enr.enrollmentId})`);
  return { enrollmentId: enr.enrollmentId, merge };
}

// ── appointment.booked (VAPI book_time) ──
async function appointmentBooked(lead, data = {}) {
  const when = data.time ? new Date(data.time) : plusDays(1);
  if (isNaN(when.getTime())) throw new Error('Invalid appointment time');

  const task = await createTask({
    leadId: lead.id,
    type: 'APPOINTMENT',
    title: `📅 Appointment: ${lead.name} — ${when.toLocaleString('en-US', { timeZone: 'America/Phoenix' })} AZ`,
    notes: data.notes || 'Booked by VAPI book_time',
    dueAt: when,
    priority: 'hot'
  });

  await brevoSMS(lead.phone,
    (lead.name || 'there').split(' ')[0] + ' - David Hughes Insurance: confirmed for ' +
    when.toLocaleString('en-US', { timeZone: 'America/Phoenix', weekday: 'long', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) +
    ' (AZ time). I will call you then - this thread works if anything changes. - David');

  const delay = Math.max(when.getTime() - Date.now(), 0);
  await callQueue.add('make-call', { leadId: lead.id }, { delay, priority: 1 });
  console.log(`📅 appointment.booked: ${lead.name} @ ${when.toISOString()} (callback queued)`);
  return { taskId: task && task.id, callbackAt: when.toISOString() };
}

// ── policy.bound (manual mark or carrier webhook) ──
async function policyBound(lead, data = {}) {
  // 1. Quote follow-up stops; bound track takes over
  const stopped = await seq.stopEnrollment(lead.id, 'policy.bound', 'quote_followup_v1');

  // 2. Policy + renewal records (spec: renewal job at bind + 320 days)
  const bindDate = data.bind_date ? new Date(data.bind_date) : new Date();
  const policy = await prisma.policy.create({
    data: {
      policyNumber: data.policy_number || ('PENDING-' + Date.now()),
      carrier: data.carrier || 'TBD',
      lineOfBusiness: lead.insuranceType || 'commercial_auto',
      status: 'ACTIVE',
      effectiveDate: bindDate,
      expirationDate: new Date(bindDate.getTime() + 365 * 86400000),
      premium: data.premium || null,
      commissionRate: data.commission_rate || null,
      accountId: lead.accountId || null
    }
  });
  await prisma.renewal.create({
    data: {
      policyId: policy.id,
      accountId: lead.accountId || null,
      renewalDate: new Date(bindDate.getTime() + 365 * 86400000)
    }
  });
  await createTask({
    leadId: lead.id,
    type: 'RENEWAL',
    title: `🔄 Renewal re-market: ${lead.name} (bound ${bindDate.toLocaleDateString('en-US')})`,
    notes: 'Spec: renewal job fires bind_date + 320 days — start shopping 45 days out.',
    dueAt: new Date(bindDate.getTime() + 320 * 86400000),
    priority: 'normal'
  });

  await prisma.lead.update({ where: { id: lead.id }, data: { status: 'converted' } });

  // 3. Cross-sell sequence (age-conditional day-16 handled inside the engine)
  const merge = {
    occ_acc_price: data.occ_acc_price || '$95-130',
    renewal_date: new Date(bindDate.getTime() + 365 * 86400000)
      .toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }),
    owner_age: lead.age || data.owner_age || null,
    age: lead.age || data.owner_age || null
  };
  const enr = await seq.enroll(lead, 'trucking_cross_sell_v1', merge, { force: data.force === true });

  // 4. Agent heads-up
  await brevoSMS(AGENT_PHONE,
    `🔒 BOUND: ${lead.name} (${lead.phone}) — ${data.carrier || 'carrier TBD'}${data.premium ? ' $' + data.premium : ''}. Cross-sell sequence started (${stopped} follow-up stopped).`);

  console.log(`🔒 policy.bound: ${lead.name} -> trucking_cross_sell_v1 (${enr.enrollmentId})`);
  return { policyId: policy.id, crossSellEnrollment: enr.enrollmentId, followupStopped: stopped };
}

// ── crosssell.consented (VAPI log_cross_sell) ──
async function crosssellConsented(lead, data = {}) {
  const product = data.product || 'occupational_accident';
  const task = await createTask({
    leadId: lead.id,
    type: 'REVIEW',
    title: `🧩 CROSS-SELL CONSENT: ${lead.name} — ${product}`,
    notes: data.notes || 'Consent captured by VAPI log_cross_sell. Quote and bind the add-on.',
    dueAt: new Date(Date.now() + 3600000),
    priority: 'hot'
  });

  // Sub-deal in the pipeline when the lead already has an account
  let opportunityId = null;
  if (lead.accountId) {
    const opp = await prisma.opportunity.create({
      data: {
        accountId: lead.accountId,
        leadId: lead.id,
        stage: 'NEW',
        lineOfBusiness: product,
        priority: 'hot'
      }
    });
    opportunityId = opp.id;
  }

  await brevoSMS(AGENT_PHONE,
    `🧩 CROSS-SELL YES: ${lead.name} (${lead.phone}) wants ${product}.${opportunityId ? ' Sub-deal created.' : ''} Quote it today.`);
  console.log(`🧩 crosssell.consented: ${lead.name} — ${product}`);
  return { taskId: task && task.id, opportunityId };
}

// ── call.dnc (hard suppression) ──
async function callDnc(lead, data = {}) {
  await addToDnc({
    phone: lead.phone,
    email: lead.email || null,
    reason: data.reason || 'DNC event',
    source: data.source || 'events'
  }, 'events:callDnc');
  const stopped = await seq.stopEnrollment(lead.id, 'dnc');
  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: 'compliance_hold', complianceStatus: 'blocked', complianceNotes: data.reason || 'DNC' }
  });
  console.log(`🚫 call.dnc: ${lead.name} (${stopped} enrollments stopped)`);
  return { dnc: true, stopped };
}

// ── quote.followup_reply (Brevo inbound webhook) ──
const STOP_WORDS = /\b(stop|unsubscribe|remove me|do not call|don'?t call|no more|done)\b/i;

async function followupReply(lead, data = {}) {
  const text = String(data.text || '');

  // Opt-out language = DNC hard stop (spec stop_condition 3)
  if (STOP_WORDS.test(text)) {
    return { ...(await callDnc(lead, { reason: 'Reply keyword: ' + text.slice(0, 80), source: 'brevo_inbound' })), via: 'stop_keyword' };
  }

  // Any other human reply: stop automation, alert agent, hand to human
  const stopped = await seq.stopEnrollment(lead.id, 'human_reply');
  await createTask({
    leadId: lead.id,
    type: 'REVIEW',
    title: `💬 REPLY from ${lead.name}: "${text.slice(0, 60)}"`,
    notes: `Channel: ${data.channel || 'sms'} · Full text: ${text}\nAutomation stopped — this lead is yours.`,
    dueAt: new Date(Date.now() + 1800000),
    priority: 'hot'
  });
  await brevoSMS(AGENT_PHONE,
    `💬 REPLY ${lead.name} (${lead.phone}): "${text.slice(0, 120)}" — automation stopped (${stopped}), it's yours.`);
  console.log(`💬 quote.followup_reply: ${lead.name} — automation stopped, agent alerted`);
  return { stopped, agentAlerted: true, via: 'human_reply' };
}

module.exports = {
  quoteCreated, quoteIssued, appointmentBooked,
  policyBound, crosssellConsented, callDnc, followupReply,
  AGENT_PHONE
};
