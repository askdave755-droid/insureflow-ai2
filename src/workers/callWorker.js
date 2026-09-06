const { callQueue } = require('../queue');
const prisma = require('../db');
const { makeCall, isLifeLead } = require('../lib/vapi');
const { isBusinessHours, getNextBusinessTime } = require('../lib/validate');
const { analyzeCall } = require('../lib/qualify');
const { analyzeLifeCall, sendLifeFollowUp } = require('../lib/life');
const { handleCallOutcome, createTask } = require('../lib/followup');

callQueue.process('make-call', 3, async (job) => {
  const { leadId, force } = job.data;
  
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error('Lead not found');
  
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
    
    // Re-queue for later
    await callQueue.add('make-call', { leadId }, { delay: nextTime - Date.now() });
    return { rescheduled: true, nextCall: nextTime };
  }
  
  // Update status + count the attempt (Phase 3 — retry engine uses this)
  await prisma.lead.update({
    where: { id: leadId },
    data: { status: 'calling', calledAt: new Date(), callAttempts: { increment: 1 } }
  });
  
  // Make the call (vapi.makeCall branches commercial vs life assistant)
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
      description: `Vapi outbound call (${result.vertical || 'commercial'})`
    }
  });
  
  return { callId: result.callId, cost: result.cost, vertical: result.vertical };
});

console.log('👷 Call worker registered on queue: vapi-calls (job: make-call, concurrency: 3)');

// ─── LIFE OUTCOME HANDLER ───
// Russell-method fact-find path: no carrier matching, no promotion to
// Account/Opportunity. Qualified = interested + fact-find score >= 50.
// Money path: LifeFactFind row + Brevo SMS/email with InsureMeNow link
// + hot task for Dave.
async function handleLifeOutcome(lead, analysis, actor = 'system') {
  const { disposition, qualified, factFind, ffScore } = analysis;
  const label = `${lead.company || lead.name} (${lead.id})`;

  // Persist fact-find (upsert — one per lead)
  let savedFF = null;
  if (Object.keys(factFind).length) {
    const { email, ...ffData } = factFind;
    savedFF = await prisma.lifeFactFind.upsert({
      where: { leadId: lead.id },
      create: { leadId: lead.id, ...ffData, email, score: ffScore, source: 'vapi_call' },
      update: { ...ffData, email, score: ffScore }
    });
    console.log(`📋 Fact-find saved for ${label}: score ${ffScore}`);
  }

  const updates = { lastDisposition: disposition };
  if (factFind.email && !lead.email) updates.email = factFind.email;

  // DNC still routes through the shared compliance path
  if (disposition === 'dnc') {
    const { addToDnc } = require('../lib/compliance');
    await addToDnc({ phone: lead.phone, email: lead.email, reason: 'Verbal opt-out during call', source: 'call_opt_out' }, actor);
    updates.status = 'compliance_hold';
    updates.complianceStatus = 'blocked';
    updates.complianceNotes = 'DNC — verbal opt-out captured on call';
  } else if (qualified) {
    updates.status = 'qualified';
    updates.qualified = true;
    updates.qualifiedAt = new Date();
  } else if (disposition === 'not_interested') {
    updates.status = 'closed';
  } else if (disposition === 'no_answer' && (lead.callAttempts || 0) >= 3) {
    updates.status = 'nurture';
  } else if (disposition === 'no_answer' || disposition === 'callback') {
    const retryAt = getNextBusinessTime(lead.state);
    updates.status = 'scheduled';
    updates.scheduledCallAt = retryAt;
    await callQueue.add('make-call', { leadId: lead.id }, {
      delay: Math.max(retryAt - Date.now(), 60000),
      priority: 10
    });
  } else {
    updates.status = 'called';
  }

  await prisma.lead.update({ where: { id: lead.id }, data: updates });

  // Qualified money path: InsureMeNow link via Brevo + hot task for Dave
  if (qualified) {
    try {
      await sendLifeFollowUp({ ...lead, ...updates }, factFind);
    } catch (err) {
      console.warn(`⚠️ Life follow-up messaging failed for ${label}: ${err.message}`);
    }
    await createTask({
      leadId: lead.id,
      type: 'REVIEW',
      title: `💚 Life fact-find complete: ${lead.name} — ${factFind.coverageGoal ? `$${factFind.coverageGoal.toLocaleString()} goal` : 'coverage TBD'}${factFind.age ? `, age ${factFind.age}` : ''}${factFind.tobacco ? ' (tobacco)' : ''}`,
      notes: `FF score: ${ffScore} | Occ: ${lead.industry || '?'} | Existing: ${factFind.existingCoverage || 'unknown'} | InsureMeNow link sent via SMS${(factFind.email || lead.email) ? ' + email' : ''}`,
      dueAt: new Date(Date.now() + 3600000),
      priority: ffScore >= 70 ? 'hot' : 'high'
    });
  }

  return { disposition, qualified, updates, factFind, ffScore };
}

// ─── WEBHOOK HANDLER (called from routes) ───
// Phase 3: every end-of-call report runs through call intelligence
// (disposition + extraction) and the follow-up engine (conversion,
// retries, DNC, tasks). Life leads branch to the fact-find path.
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

  let callLog = await prisma.callLog.findFirst({
    where: { callId },
    include: { lead: true }
  });

  if (!callLog) {
    console.error('❌ Call log not found for Vapi call ID:', callId);
    const orphanLead = await prisma.lead.findFirst({ where: { vapiCallId: callId } });
    if (!orphanLead) {
      console.error('❌ No lead found with vapiCallId either:', callId);
      return { error: 'callLog not found', callId };
    }
    console.log(`⚠️ Found lead ${orphanLead.id} by vapiCallId but no CallLog row — creating one`);
    const newLog = await prisma.callLog.create({
      data: { leadId: orphanLead.id, callId, status: message.call?.status || 'ended', duration, transcript, summary, recordingUrl }
    });
    callLog = { ...newLog, lead: orphanLead };
  }

  // Fresh lead (callAttempts etc. may have changed since the job ran)
  const lead = await prisma.lead.findUnique({ where: { id: callLog.leadId } });
  if (!lead) {
    console.error('❌ Lead vanished between call and webhook:', callLog.leadId);
    return { error: 'lead not found', leadId: callLog.leadId };
  }

  const life = isLifeLead(lead);

  // Vertical-specific analysis: life fact-find vs commercial qualification
  const analysis = life
    ? analyzeLifeCall({ transcript, summary, successEvaluation, duration })
    : analyzeCall({ transcript, summary, successEvaluation, duration });

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

  const outcome = life
    ? await handleLifeOutcome(lead, analysis, 'webhook:vapi')
    : await handleCallOutcome(lead, analysis, 'webhook:vapi');

  if (outcome.qualified) {
    console.log(`🔥 QUALIFIED ${life ? '[LIFE]' : ''} (${outcome.disposition}): ${lead.name} (${lead.company})${life ? ` — FF score ${outcome.ffScore}` : ''}`);
  } else {
    console.log(`📞 Outcome: ${lead.name} → ${outcome.disposition} (status: ${outcome.updates.status})`);
  }

  return {
    qualified: outcome.qualified,
    disposition: outcome.disposition,
    leadId: lead.id,
    vertical: life ? 'life' : 'commercial',
    ...(life ? { factFind: outcome.factFind, ffScore: outcome.ffScore } : { extracted: analysis.intel })
  };
}

module.exports = { handleVapiWebhook };
