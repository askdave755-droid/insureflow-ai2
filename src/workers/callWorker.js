const { callQueue } = require('../queue');
const prisma = require('../db');
const pool = require('../lib/pool');
const { makeCall, isLifeLead } = require('../lib/vapi');
const { isBusinessHours, getNextBusinessTime } = require('../lib/validate');
const { analyzeCall } = require('../lib/qualify');
const { handleLifeCallDone } = require('../lib/lifePipeline');
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

// ─── WEBHOOK HANDLER (called from routes) ───
async function handleVapiWebhook(webhookData) {
  const message = webhookData.message || {};
  console.log('📬 Vapi webhook:', message?.type, message?.call?.id);

  if (message.type !== 'end-of-call-report') {
    return { ignored: message.type };
  }

  const callId = message.call?.id;
  if (!callId) throw new Error('Missing call ID');

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

  const lead = await prisma.lead.findUnique({ where: { id: callLog.leadId } });
  if (!lead) {
    console.error('❌ Lead vanished between call and webhook:', callLog.leadId);
    return { error: 'lead not found', leadId: callLog.leadId };
  }

  // ══════════════════════════════════════════════════════════════
  // LIFE path — original Russell pipeline (lib/lifePipeline.js):
  // extractFactFind -> UPDATE leads fact-find columns -> Brevo
  // quotes email (InsureMeNow Direct link) or email-capture SMS.
  // Qualified = email + age captured.
  // ══════════════════════════════════════════════════════════════
  if (isLifeLead(lead)) {
    const ff = await handleLifeCallDone(lead, { transcript, summary }, pool);
    const qualified = !!(ff.email && ff.age);
    const disposition = qualified ? 'qualified' : (duration !== null && duration < 20 ? 'no_answer' : 'completed');

    await prisma.callLog.update({
      where: { id: callLog.id },
      data: {
        status: message.call?.status || 'ended',
        duration,
        transcript,
        summary,
        qualified,
        disposition,
        recordingUrl
      }
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastDisposition: disposition }
    });

    // Verbal opt-out still routes through the shared DNC engine
    if (/\b(do[- ]not[- ]call|remove me (from|off)|stop calling|take me off)\b/i.test(transcript || '')) {
      const { addToDnc } = require('../lib/compliance');
      await addToDnc({ phone: lead.phone, email: lead.email, reason: 'Verbal opt-out during call', source: 'call_opt_out' }, 'webhook:vapi');
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: 'compliance_hold', complianceStatus: 'blocked', complianceNotes: 'DNC — verbal opt-out captured on call' }
      });
      console.log(`🚫 DNC [LIFE]: ${lead.name}`);
      return { qualified: false, disposition: 'dnc', leadId: lead.id, vertical: 'life_fe', factFind: ff };
    }

    if (qualified) {
      await createTask({
        leadId: lead.id,
        type: 'REVIEW',
        title: `💚 Life quotes sent: ${lead.name} — ${ff.coverage_amount ? `$${ff.coverage_amount.toLocaleString()}` : 'coverage TBD'}${ff.age ? `, age ${ff.age}` : ''}${ff.smoker ? ' (tobacco)' : ''}`,
        notes: `Occ: ${lead.occupation || lead.industry || '?'} | Premium: ${ff.monthly_premium ? `$${ff.monthly_premium}/mo` : '?'} | Meds: ${ff.medications || 'none noted'} | Quotes email → ${ff.email}`,
        dueAt: new Date(Date.now() + 3600000),
        priority: 'hot'
      });
      console.log(`🔥 QUALIFIED [LIFE]: ${lead.name} — quotes emailed to ${ff.email}`);
    } else {
      console.log(`📞 Life outcome: ${lead.name} → ${disposition}`);
    }

    return { qualified, disposition, leadId: lead.id, vertical: 'life_fe', factFind: ff };
  }

  // ══════════════════════════════════════════════════════════════
  // COMMERCIAL path (unchanged)
  // ══════════════════════════════════════════════════════════════
  const analysis = analyzeCall({ transcript, summary, successEvaluation, duration });

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
    vertical: 'commercial_auto',
    extracted: analysis.intel
  };
}

module.exports = { handleVapiWebhook };
