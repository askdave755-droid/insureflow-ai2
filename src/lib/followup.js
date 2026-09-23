// ═══════════════════════════════════════════════
// FOLLOW-UP ENGINE (Phase 3)
// Routes every completed call to its next action:
// booked/interested → Brevo follow-up + conversion + Dave task
// callback          → Calendly SMS (keep Frank's promise) + requeue + task
// no_answer         → retry up to 3 attempts, then nurture + task
// dnc               → internal DNC + compliance hold (never contacted again)
// not_interested    → closed
// completed         → low-priority review task (real conversation, no clear ask)
// ═══════════════════════════════════════════════

const prisma = require('../db');
const { callQueue } = require('../queue');
const { sendEmail } = require('./messaging');

// Owner notifications inbox — env-overridable via OWNER_EMAIL.
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'nexusgpartners@gmail.com';

// Hottest outcomes — straight to the owner's inbox. Fire-and-forget: alert
// failure must never break the outcome pipeline.
async function ownerAlert(subject, body) {
  try { await sendEmail(OWNER_EMAIL, subject, body); }
  catch (e) { console.warn(`⚠️ ownerAlert failed (${subject}): ${e.message}`); }
}
const { getNextBusinessTime } = require('./validate');
const { handleQualifiedLead } = require('./messaging');
const { addToDnc } = require('./compliance');
const { promoteLead } = require('./convert');
const { audit } = require('./audit');

const MAX_CALL_ATTEMPTS = 3;

async function createTask({ leadId = null, opportunityId = null, accountId = null, type, title, notes = null, dueAt = null, priority = 'normal' }) {
  const task = await prisma.task.create({
    data: { leadId, opportunityId, accountId, type, title, notes, dueAt, priority }
  });
  console.log(`📝 Task created [${type}/${priority}]: ${title}`);
  return task;
}

// Merge extracted call intel — never overwrite known data with null.
function intelUpdates(lead, intel) {
  const updates = {};
  if (intel.vehicleCount && !lead.vehicleCount) updates.vehicleCount = intel.vehicleCount;
  if (intel.driverCount && !lead.driverCount) updates.driverCount = intel.driverCount;
  if (intel.currentCarrier && !lead.currentCarrier) updates.currentCarrier = intel.currentCarrier;
  if (intel.xDate && !lead.xDate) updates.xDate = intel.xDate;
  if (intel.email && !lead.email) updates.email = intel.email;
  return updates;
}

function leadPriority(lead) {
  return lead.scoreBand === 'HOT' ? 1 : lead.scoreBand === 'GOOD' ? 5 : 10;
}

async function handleCallOutcome(lead, analysis, actor = 'system') {
  const { disposition, qualified, intel } = analysis;
  const label = `${lead.company || lead.name} (${lead.id})`;

  const updates = {
    lastDisposition: disposition,
    ...intelUpdates(lead, intel)
  };
  let task = null;

  switch (disposition) {
    case 'dnc': {
      await addToDnc({
        phone: lead.phone,
        email: lead.email,
        reason: 'Verbal opt-out during call',
        source: 'call_opt_out'
      }, actor);
      updates.status = 'compliance_hold';
      updates.complianceStatus = 'blocked';
      updates.complianceNotes = 'DNC — verbal opt-out captured on call';
      console.log(`🚫 DNC captured: ${label} — added to internal DNC`);
      break;
    }

    case 'booked':
    case 'interested': {
      updates.status = 'qualified';
      updates.qualified = true;
      updates.qualifiedAt = new Date();
      break;
    }

    case 'callback': {
      // Frank promised a text with the calendar link — keep the promise.
      try {
        const { brevoSMS } = require('./brevo');
        const config = require('../config');
        const first = (lead.name || 'there').split(' ')[0];
        await brevoSMS(lead.phone,
          first + ', Frank here (David Hughes Insurance) - good talking. Grab your 4-minute comparison slot here: ' +
          config.CALENDLY_LINK + ' Reply STOP to opt out');
      } catch (err) {
        console.warn(`⚠️ Callback SMS failed for ${label}: ${err.message}`);
      }
      const retryAt = getNextBusinessTime(lead.state);
      // PATCH 1/3: callback_pending takes the lead out of the cold queue; the
      // re-dial is a flagged callback job (cap bypass, callback intro).
      updates.status = 'callback_pending';
      updates.scheduledCallAt = retryAt;
      // Stagger 0-120s so a wave of callbacks doesn't mature at the same second
      await callQueue.add('make-call', { leadId: lead.id, type: 'callback' }, {
        delay: Math.max(retryAt - Date.now(), 60000) + Math.floor(Math.random() * 120000),
        priority: 1,
        jobId: `callback-${lead.id}-${retryAt.getTime()}`
      });
      task = await createTask({
        leadId: lead.id,
        type: 'CALL_BACK',
        title: `Call back ${lead.name} @ ${lead.company || 'unknown co'} — asked for a callback`,
        dueAt: retryAt,
        priority: lead.scoreBand === 'HOT' ? 'hot' : 'normal'
      });
      await ownerAlert(
        `CALLBACK: ${lead.name} (${lead.company || 'unknown co'})`,
        `${lead.name} asked for a callback on commercial auto.\nPhone: ${lead.phone}\nWhen: ${retryAt.toISOString()}\nNotes: asked Frank to call back during the AI call`
      );
      break;
    }

    case 'no_answer': {
      const attempts = lead.callAttempts || 0;
      if (attempts >= MAX_CALL_ATTEMPTS) {
        updates.status = 'nurture';
        task = await createTask({
          leadId: lead.id,
          type: 'FOLLOW_UP',
          title: `No answer after ${attempts} attempts — try manual/email outreach: ${lead.company || lead.name}`,
          notes: `Phone: ${lead.phone}${lead.email ? ` | Email: ${lead.email}` : ''}${lead.dotNumber ? ` | DOT#${lead.dotNumber}` : ''}`,
          priority: 'low'
        });
        console.log(`🌱 ${label} → nurture after ${attempts} no-answer attempts`);
      } else {
        const retryAt = getNextBusinessTime(lead.state);
        updates.status = 'scheduled';
        updates.scheduledCallAt = retryAt;
        // Stagger 0-120s so a wave of no-answer retries doesn't mature at the same second
        await callQueue.add('make-call', { leadId: lead.id }, {
          delay: Math.max(retryAt - Date.now(), 60000) + Math.floor(Math.random() * 120000),
          priority: leadPriority(lead)
        });
        console.log(`🔁 Retry scheduled for ${label} (attempt ${attempts}/${MAX_CALL_ATTEMPTS})`);
      }
      break;
    }

    case 'not_interested': {
      updates.status = 'closed';
      break;
    }

    case 'completed': {
      // Real conversation, but no explicit booking/callback/interest phrase.
      // Keep the lead visible instead of letting it die as "called".
      updates.status = 'called';
      task = await createTask({
        leadId: lead.id,
        type: 'FOLLOW_UP',
        title: `Review completed call: ${lead.company || lead.name} — no clear next step captured`,
        notes: `Phone: ${lead.phone}${lead.email ? ` | Email: ${lead.email}` : ''} | Disposition: completed | Review the transcript and choose callback / nurture / close.`,
        priority: 'low'
      });
      console.log(`🧾 ${label} completed without a clear ask — review task created`);
      break;
    }

    default: {
      updates.status = 'called';
    }
  }

  await prisma.lead.update({ where: { id: lead.id }, data: updates });

  // ─── QUALIFIED MONEY PATH ───
  // Brevo follow-up (existing carrier-aware SMS+email) → promote to
  // Account + Opportunity → task for Dave to confirm the booking.
  if (qualified) {
    try {
      await handleQualifiedLead({ ...lead, ...updates });
    } catch (err) {
      console.warn(`⚠️ Qualified follow-up messaging failed for ${label}: ${err.message}`);
    }
    try {
      await prisma.lead.update({ where: { id: lead.id }, data: { quoteEmailSent: true } });
    } catch (err) {
      console.warn(`⚠️ quoteEmailSent flag failed for ${label}: ${err.message}`);
    }
    try {
      const { account, opportunity } = await promoteLead(lead.id, actor);
      task = await createTask({
        leadId: lead.id,
        opportunityId: opportunity.id,
        accountId: account.id,
        type: 'REVIEW',
        title: `🔥 New qualified opportunity: ${lead.company || lead.name} — confirm booking / prep comparison`,
        notes: `Disposition: ${disposition} | Band: ${lead.scoreBand || 'unscored'} | Opp score: ${lead.opportunityScore ?? '?'} | X-date: ${lead.xDate ? new Date(lead.xDate).toISOString().slice(0, 10) : 'unknown'}`,
        dueAt: new Date(Date.now() + 3600000),
        priority: 'hot'
      });
      await ownerAlert(
        `CONVERTED: ${lead.name} (${lead.company || 'unknown co'})`,
        `${lead.name} qualified on commercial auto (disposition: ${disposition}).\nPhone: ${lead.phone}\nNotes: qualified on the AI call — opportunity created, confirm booking / prep comparison`
      );
    } catch (err) {
      console.error(`❌ Conversion failed for ${label}: ${err.message}`);
    }
  }

  await audit({
    actor,
    action: 'call_outcome',
    entityType: 'Lead',
    entityId: lead.id,
    after: { disposition, qualified, status: updates.status, intel }
  });

  return { disposition, qualified, updates, taskId: task?.id || null };
}

module.exports = { handleCallOutcome, createTask, MAX_CALL_ATTEMPTS };
