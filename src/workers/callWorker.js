const { callQueue } = require('../queue');
const prisma = require('../db');
const pool = require('../lib/pool');
const { makeCall, isLifeLead } = require('../lib/vapi');
const { isBusinessHours, getNextBusinessTime } = require('../lib/validate');
const { analyzeCall } = require('../lib/qualify');
const { handleLifeCallDone } = require('../lib/lifePipeline');
const { handleCallOutcome, createTask } = require('../lib/followup');
const { canDial, markDialing, markEnded } = require('../lib/callSemaphore');

// PATCH-1 helpers: phone fallback + pending report queue
const pendingReports = new Map(); // callId -> {message, expires}
const PENDING_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingReports) if (v.expires < now) pendingReports.delete(k);
}, 60 * 1000).unref();

function normalizePhoneE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const d = digits.length === 10 ? '1' + digits : digits;
  return d.length === 11 && d.startsWith('1') ? '+' + d : null;
}

async function resolveLeadForReport(message) {
  const callId = message?.call?.id;
  let lead = callId
    ? await prisma.lead.findFirst({ where: { vapiCallId: callId } })
    : null;
  if (lead) return { lead, via: 'vapiCallId' };
  const called = normalizePhoneE164(
    message?.call?.phoneNumber || message?.call?.customer?.number);
  if (called) {
    lead = await prisma.lead.findFirst({
      where: { phone: called, status: 'calling' },
      orderBy: { updatedAt: 'desc' },
    });
    if (lead) return { lead, via: 'phone' };
  }
  return { lead: null, via: null };
}

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
  
  // Vapi concurrency gate — requeue with jittered backoff instead of slamming
  // the API and burning the daily cap on 'Over Concurrency Limit' rejections.
  // Returns cleanly so Bull does not count this as a failure or a retry attempt.
  if (!force && !(await canDial())) {
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'pending' }
    });
    await callQueue.add('make-call', { leadId }, {
      delay: 30000 + Math.floor(Math.random() * 30000),
      priority: 5,
      jobId: `gate-${leadId}-${Date.now()}`
    });
    return { requeued: 'concurrency' };
  }

  // Update status + count the attempt (Phase 3 — retry engine uses this)
  await prisma.lead.update({
    where: { id: leadId },
    data: { status: 'calling', calledAt: new Date(), callAttempts: { increment: 1 } }
  });
  
  // Make the call (vapi.makeCall branches commercial vs life assistant)
  const result = await makeCall(lead);
  
  if (!result.success) {
    const msg = result.error || '';
    if (msg.includes('Concurrency') || msg.includes('concurrency')) {
      // Vapi-side limit hit anyway (race with another worker) — long backoff,
      // no failure status, no cap penalty (cap counts accepted dials only).
      await prisma.lead.update({ where: { id: leadId }, data: { status: 'pending' } });
      await callQueue.add('make-call', { leadId }, {
        delay: 60000 + Math.floor(Math.random() * 30000),
        priority: 5,
        jobId: `vlimit-${leadId}-${Date.now()}`
      });
      console.log(`⏳ Vapi concurrency hit — requeued ${leadId} in ~60-90s`);
      return { requeued: 'vapi_concurrency' };
    }
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'failed' }
    });
    throw new Error(`Call failed: ${result.error}`);
  }

  await markDialing(result.callId);
  
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

  await markEnded(callId); // release concurrency slot

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
    let orphanLead = await prisma.lead.findFirst({ where: { vapiCallId: callId } });
    let via = 'vapiCallId';
    if (!orphanLead) {
      const resolved = await resolveLeadForReport(message);
      orphanLead = resolved.lead;
      via = resolved.via;
      if (orphanLead && via === 'phone') {
        console.warn(`📞 end-of-call-report ${callId} matched lead ${orphanLead.id} by phone (worker race) — backfilling vapiCallId`);
        await prisma.lead.update({
          where: { id: orphanLead.id },
          data: { vapiCallId: callId },
        }).catch(() => {});
      }
    }
    if (!orphanLead) {
      // Worker DB writes may not have committed yet — retry once in 30s.
      if (!pendingReports.has(callId)) {
        pendingReports.set(callId, { message, expires: Date.now() + PENDING_TTL_MS });
        console.warn(`⏳ end-of-call-report ${callId} unmatched — queued for 30s retry`);
        setTimeout(async () => {
          const p = pendingReports.get(callId);
          if (!p) return; // already resolved another way
          pendingReports.delete(callId);
          await handleVapiWebhook(p.message).catch(e =>
            console.error(`retry end-of-call-report ${callId} failed:`, e.message));
        }, 30000);
      }
      return { queued: true, callId }; // NOT an error — queued or duplicate
    }
    console.log(`⚠️ No CallLog row for ${callId} — creating one (via ${via})`);
    callLog = await prisma.callLog.create({
      data: {
        leadId: orphanLead.id,
        callId,
        status: message.call?.status || 'ended',
        duration,
        transcript,
        summary,
        recordingUrl
      }
    });
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
  // Fallback: if lead has no email, pull one spoken on the call from the transcript
  if (!lead.email) {
    const m = (transcript || '').match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
    if (m) analysis.intel = { ...(analysis.intel || {}), email: m[1].toLowerCase() };
  }

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