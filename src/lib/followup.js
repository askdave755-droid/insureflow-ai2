// ═══════════════════════════════════════════════
// FOLLOW-UP ENGINE (Phase 3)
// Routes every completed call to its next action:
// booked/interested → Brevo follow-up + conversion + Dave task
// callback          → requeue at next window + task
// no_answer         → retry up to 3 attempts, then nurture + task
// dnc               → internal DNC + compliance hold (never contacted again)
// not_interested    → closed
// ═══════════════════════════════════════════════

const prisma = require('../db');
const { callQueue } = require('../queue');
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
      const retryAt = getNextBusinessTime(lead.state);
      updates.status = 'scheduled';
      updates.scheduledCallAt = retryAt;
      await callQueue.add('make-call', { leadId: lead.id }, {
        delay: Math.max(retryAt - Date.now(), 60000),
        priority: leadPriority(lead),
        jobId: `call:${lead.id}` // Bull dedupe — one pending call job per lead
      });
      task = await createTask({
        leadId: lead.id,
        type: 'CALL_BACK',
        title: `Call back ${lead.name} @ ${lead.company || 'unknown co'} — asked for a callback`,
        dueAt: retryAt,
        priority: lead.scoreBand === 'HOT' ? 'hot' : 'normal'
      });
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
        await callQueue.add('make-call', { leadId: lead.id }, {
          delay: Math.max(retryAt - Date.now(), 60000),
          priority: leadPriority(lead),
          jobId: `call:${lead.id}` // Bull dedupe — one pending call job per lead
        });
        console.log(`🔁 Retry scheduled for ${label} (attempt ${attempts}/${MAX_CALL_ATTEMPTS})`);
      }
      break;
    }

    case 'not_interested': {
      updates.status = 'closed';
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
