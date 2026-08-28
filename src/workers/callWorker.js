const { callQueue } = require('../queue');
const prisma = require('../db');
const { makeCall } = require('../lib/vapi');
const { isBusinessHours, getNextBusinessTime } = require('../lib/validate');
const { analyzeCall } = require('../lib/qualify');
const { handleCallOutcome } = require('../lib/followup');
const { recheckDncAtDialTime } = require('../lib/compliance');

callQueue.process('make-call', 3, async (job) => {
  const { leadId, force } = job.data;

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error('Lead not found');

  // SPEC §6 — dial-time DNC/compliance recheck. Runs on EVERY job, even
  // when queue-time compliance passed earlier (DNC may have been added
  // while the job sat in Redis) and even in force mode: force may skip
  // business hours but NEVER DNC. Blocked leads → compliance_hold + audit,
  // and no call is placed.
  const recheck = await recheckDncAtDialTime(lead, 'worker:call');
  if (recheck.blocked) {
    console.log(`🚫 Dial-time compliance BLOCK for lead ${leadId}: ${recheck.reasons.join('; ')} — no call placed`);
    return { blocked: true, reasons: recheck.reasons };
  }

  // Double-check business hours (skipped in force mode)
  if (force) {
    console.log('⚡ Force mode: skipping business hours check');
  } else if (!isBusinessHours(lead.state)) {
    console.log(`⏳ Rescheduling ${leadId} - outside business hours`);
    const nextTime = getNextBusinessTime(lead.state);

    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'scheduled', scheduledCallAt: nextTime }
    });

    // Re-queue for later. The active job holds jobId `call:${leadId}` —
    // remove it first so the delayed replacement isn't deduped away.
    try { await job.remove(); } catch (err) {
      console.warn(`⚠️ Could not remove active job ${job.id} before reschedule: ${err.message}`);
    }
    const requeued = await callQueue.add('make-call', { leadId }, {
      delay: nextTime - Date.now(),
      jobId: `call:${leadId}` // Bull dedupe — one pending call job per lead
    });
    if (requeued.id === job.id) {
      console.warn(`⚠️ Reschedule for lead ${leadId} was deduped against its own active job — lead stays 'scheduled' with scheduledCallAt set`);
    }
    return { rescheduled: true, nextCall: nextTime };
  }
  
  // Update status + count the attempt (Phase 3 — retry engine uses this)
  await prisma.lead.update({
    where: { id: leadId },
    data: { status: 'calling', calledAt: new Date(), callAttempts: { increment: 1 } }
  });
  
  // Make the call
  const result = await makeCall(lead);
  
  if (!result.success) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'failed' }
    });
    throw new Error(`Call failed: ${result.error}`);
  }
  
  // Save call log
  await prisma.callLog.create({
    data: {
      leadId,
      callId: result.callId,
      status: 'initiated',
      cost: result.cost
    }
  });
  
  await prisma.lead.update({
    where: { id: leadId },
    data: { 
      status: 'called',
      vapiCallId: result.callId,
      vapiCost: result.cost
    }
  });
  
  // Track cost
  await prisma.cost.create({
    data: {
      leadId,
      type: 'voice',
      amount: result.cost || 0.05,
      description: 'Vapi outbound call'
    }
  });
  
  return { callId: result.callId, cost: result.cost };
});

console.log('👷 Call worker registered on queue: vapi-calls (job: make-call, concurrency: 3)');

// ─── WEBHOOK HANDLER (called from routes) ───
// Phase 3: every end-of-call report runs through call intelligence
// (disposition + extraction) and the follow-up engine (conversion,
// retries, DNC, tasks).
async function handleVapiWebhook(webhookData) {
  const message = webhookData.message || {};
  console.log('📬 Vapi webhook:', message?.type, message?.call?.id);

  // Only process the final end-of-call report; ignore status-update,
  // transcript updates, speech events, etc.
  if (message.type !== 'end-of-call-report') {
    return { ignored: message.type };
  }

  const callId = message.call?.id;
  if (!callId) throw new Error('Missing call ID');

  // Extract with fallbacks for the various Vapi payload shapes
  const transcript = message.artifact?.transcript || message.transcript || '';
  const summary = message.analysis?.summary || message.summary || '';
  const recordingUrl = message.artifact?.recordingUrl || '';
  let duration = null;
  if (message.artifact?.durationMs) {
    duration = Math.round(message.artifact.durationMs / 1000);
  } else if (message.call?.startedAt && message.call?.endedAt) {
    duration = Math.round((new Date(message.call.endedAt) - new Date(message.call.startedAt)) / 1000);
  }
  const successEvaluation = message.analysis?.successEvaluation;

  // Phase 3 — call intelligence
  const analysis = analyzeCall({ transcript, summary, successEvaluation, duration });

  let callLog = await prisma.callLog.findFirst({
    where: { callId },
    include: { lead: true }
  });

  if (!callLog) {
    console.error('❌ Call log not found for Vapi call ID:', callId);
    // Fallback: maybe the lead has this vapiCallId but no callLog row
    const orphanLead = await prisma.lead.findFirst({ where: { vapiCallId: callId } });
    if (!orphanLead) {
      console.error('❌ No lead found with vapiCallId either:', callId);
      return { error: 'callLog not found', callId };
    }
    console.log(`⚠️ Found lead ${orphanLead.id} by vapiCallId but no CallLog row — creating one`);
    const newLog = await prisma.callLog.create({
      data: {
        leadId: orphanLead.id,
        callId,
        status: message.call?.status || 'ended',
        duration,
        transcript,
        summary,
        qualified: analysis.qualified,
        disposition: analysis.disposition,
        recordingUrl
      }
    });
    callLog = { ...newLog, lead: orphanLead };
  } else {
    // Update call log with final outcome
    await prisma.callLog.update({
      where: { id: callLog.id },
      data: {
        status: message.call?.status || 'ended',
        duration,
        transcript,
        summary,
        qualified: analysis.qualified,
        disposition: analysis.disposition,
        recordingUrl
      }
    });
  }

  // Fresh lead (callAttempts etc. may have changed since the job ran)
  const lead = await prisma.lead.findUnique({ where: { id: callLog.leadId } });
  if (!lead) {
    console.error('❌ Lead vanished between call and webhook:', callLog.leadId);
    return { error: 'lead not found', leadId: callLog.leadId };
  }

  // Phase 3 — follow-up engine: conversion, retries, DNC, tasks, messaging
  const outcome = await handleCallOutcome(lead, analysis, 'webhook:vapi');

  if (outcome.qualified) {
    console.log(`🔥 QUALIFIED (${outcome.disposition}): ${lead.name} (${lead.company})`);
  } else {
    console.log(`📞 Outcome: ${lead.name} → ${outcome.disposition} (status: ${outcome.updates.status})`);
  }

  return {
    qualified: outcome.qualified,
    disposition: outcome.disposition,
    leadId: lead.id,
    extracted: analysis.intel
  };
}

module.exports = { handleVapiWebhook };
