const { callQueue } = require('../queue');
const prisma = require('../db');
const { makeCall } = require('../lib/vapi');
const { isBusinessHours, isQualified } = require('../lib/validate');
const { handleQualifiedLead } = require('../lib/messaging');

callQueue.process('make-call', 3, async (job) => {
  const { leadId } = job.data;
  
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new Error('Lead not found');
  
  // Double-check business hours
  if (!isBusinessHours(lead.state)) {
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
  const { call, analysis } = webhookData.message || {};
  if (!call?.id) throw new Error('Missing call ID');
  
  const callLog = await prisma.callLog.findFirst({
    where: { callId: call.id },
    include: { lead: true }
  });
  
  if (!callLog) {
    console.error('Call log not found for:', call.id);
    return;
  }
  
  const qualified = isQualified(call.transcript) || 
                    analysis?.successEvaluation?.toLowerCase()?.includes('success');
  
  // Update call log
  await prisma.callLog.update({
    where: { id: callLog.id },
    data: {
      status: call.status,
      duration: call.duration,
      transcript: call.transcript,
      summary: analysis?.summary,
      qualified
    }
  });
  
  // Update lead
  await prisma.lead.update({
    where: { id: callLog.leadId },
    data: {
      status: qualified ? 'qualified' : 'not_interested',
      qualified,
      transcript: call.transcript,
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
