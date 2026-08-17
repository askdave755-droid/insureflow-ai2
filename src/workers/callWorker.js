const { callQueue } = require('../queue');
const prisma = require('../db');
const { makeCall } = require('../lib/vapi');
const { isBusinessHours, isQualified } = require('../lib/validate');
const { handleQualifiedLead } = require('../lib/messaging');

callQueue.process('make-call', 3, async (job) => {
  const { leadId, force } = job.data;
  
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error('Lead not found');
  
  // Double-check business hours (skipped in force mode)
  if (force) {
    console.log('⚡ Force mode: skipping business hours check');
  } else if (!isBusinessHours(lead.state)) {
    console.log(`⏳ Rescheduling ${leadId} - outside business hours`);
    const { getNextBusinessTime } = require('../lib/validate');
    const nextTime = getNextBusinessTime(lead.state);
    
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'scheduled', scheduledCallAt: nextTime }
    });
    
    // Re-queue for later
    await callQueue.add('make-call', { leadId }, { delay: nextTime - Date.now() });
    return { rescheduled: true, nextCall: nextTime };
  }
  
  // Update status
  await prisma.lead.update({
    where: { id: leadId },
    data: { status: 'calling', calledAt: new Date() }
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

  const callLog = await prisma.callLog.findFirst({
    where: { callId },
    include: { lead: true }
  });

  if (!callLog) {
    console.error('❌ Call log not found for Vapi call ID:', callId);
    // Fallback: maybe the lead has this vapiCallId but no callLog row
    const lead = await prisma.lead.findFirst({ where: { vapiCallId: callId } });
    if (lead) {
      console.log(`⚠️ Found lead ${lead.id} by vapiCallId but no CallLog row — creating one`);
      const qualified = isQualified(transcript) ||
                        (successEvaluation && String(successEvaluation).toLowerCase().includes('success')) ||
                        false;
      const newLog = await prisma.callLog.create({
        data: {
          leadId: lead.id,
          callId,
          status: message.call?.status || 'ended',
          duration,
          transcript,
          summary,
          qualified,
          recordingUrl
        }
      });
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: qualified ? 'qualified' : 'not_interested',
          qualified,
          transcript,
          qualifiedAt: qualified ? new Date() : null
        }
      });
      if (qualified) {
        console.log(`🔥 QUALIFIED: ${lead.name} (${lead.company})`);
        await handleQualifiedLead(lead);
      }
      return { qualified, leadId: lead.id, callLogCreated: newLog.id };
    }
    console.error('❌ No lead found with vapiCallId either:', callId);
    return { error: 'callLog not found', callId };
  }

  const qualified = isQualified(transcript) ||
                    (successEvaluation && String(successEvaluation).toLowerCase().includes('success')) ||
                    false;

  // Update call log
  await prisma.callLog.update({
    where: { id: callLog.id },
    data: {
      status: message.call?.status || 'ended',
      duration,
      transcript,
      summary,
      qualified,
      recordingUrl
    }
  });

  // Update lead
  await prisma.lead.update({
    where: { id: callLog.leadId },
    data: {
      status: qualified ? 'qualified' : 'not_interested',
      qualified,
      transcript,
      qualifiedAt: qualified ? new Date() : null
    }
  });

  // If qualified, trigger followups
  if (qualified) {
    console.log(`🔥 QUALIFIED: ${callLog.lead.name} (${callLog.lead.company})`);
    await handleQualifiedLead(callLog.lead);
  }

  return { qualified, leadId: callLog.leadId };
}

module.exports = { handleVapiWebhook };
