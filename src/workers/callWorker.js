const { callQueue } = require('../queue');
const prisma = require('../db');
const pool = require('../lib/pool');
const { makeCall, isLifeLead } = require('../lib/vapi');
const { isBusinessHours, getNextBusinessTime } = require('../lib/validate');
const { analyzeCall } = require('../lib/qualify');
const { handleLifeCallDone } = require('../lib/lifePipeline');
const { handleCallOutcome, createTask } = require('../lib/followup');
const { canDial, markDialing, markEnded } = require('../lib/callSemaphore');

// ─── PATCH 2: dial cap enforced AT DIAL TIME (not just at the feeder) ───
const { DateTime } = require('luxon');
const DAILY_CAP = parseInt(process.env.DAILY_CAP || '45', 10);
const CALLBACK_CONCURRENCY = 1;
const CALLBACK_ACTIVE_KEY = 'vapi:active_callbacks';
const redis = require('../lib/redis');

// Today's dials for a vertical (ET day boundary, matches the feeder's intent)
async function dialsTodayForVertical(vertical) {
  const startOfDay = DateTime.now().setZone('America/New_York').startOf('day').toJSDate();
  return prisma.callLog.count({
    where: { createdAt: { gte: startOfDay }, lead: { vertical } }
  });
}

// ms until 07:00 tomorrow ET (business-hours gate takes over from there)
function msUntilTomorrow7amET() {
  const t = DateTime.now().setZone('America/New_York').plus({ days: 1 })
    .set({ hour: 7, minute: 0, second: 0, millisecond: 0 });
  return Math.max(t.toMillis() - Date.now(), 60000);
}

async function activeCallbacks() { return redis.scard(CALLBACK_ACTIVE_KEY); }
async function markCallbackDialing(callId) {
  if (!callId) return;
  await redis.sadd(CALLBACK_ACTIVE_KEY, callId);
  await redis.expire(CALLBACK_ACTIVE_KEY, 3600);
}
async function markCallbackEnded(callId) { if (callId) await redis.srem(CALLBACK_ACTIVE_KEY, callId); }

// ─── PATCH 1: dial dedupe guard ───
const RECENT_CALL_DAYS = 5;
const CALLBACK_DISPOSITIONS = new Set(['callback', 'appointment', 'requested_callback']);

// Remove every other queued/delayed make-call job for this lead (duplicate
// queue entries were the root of the 3x-in-80-min dials).
async function removeQueuedCallsForLead(leadId, exceptJobId = null) {
  let removed = 0;
  const jobs = await callQueue.getJobs(['delayed', 'waiting', 'paused', 'prioritized']);
  for (const j of jobs) {
    if (!j || j.name !== 'make-call' || j.data?.leadId !== leadId) continue;
    if (exceptJobId && String(j.id) === String(exceptJobId)) continue;
    try { await j.remove(); removed++; } catch (e) { /* already active/locked */ }
  }
  return removed;
}

// Was this phone dialed (call completed) within the last N days?
async function recentCompletedCall(phone, days = RECENT_CALL_DAYS) {
  if (!phone) return null;
  return prisma.callLog.findFirst({
    where: {
      createdAt: { gte: new Date(Date.now() - days * 86400000) },
      status: { notIn: ['initiated', 'queued', 'ringing', 'in-progress'] },
      lead: { phone }
    },
    orderBy: { createdAt: 'desc' }
  });
}

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

  // PATCH 1: cold queue skips callback_pending leads entirely — the callback
  // dialer (data.type === 'callback') is the only thing allowed to dial them.
  if (lead.status === 'callback_pending' && job.data.type !== 'callback' && !force) {
    await removeQueuedCallsForLead(leadId, job.id);
    console.log(`⏭️ skip ${lead.name} — callback_pending (cold queue)`);
    return { skipped: 'callback_pending' };
  }

  // PATCH 1: dedupe guard — never re-dial a phone completed within 5 days
  if (!force && job.data.type !== 'callback') {
    const recent = await recentCompletedCall(lead.phone);
    if (recent) {
      const daysAgo = Math.floor((Date.now() - new Date(recent.createdAt).getTime()) / 86400000);
      await prisma.lead.update({ where: { id: leadId }, data: { status: 'recently_called' } });
      await removeQueuedCallsForLead(leadId, job.id);
      console.log(`⏭️ skip ${lead.name} — called ${daysAgo}d ago`);
      return { skipped: 'recently_called', daysAgo };
    }
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
    
    // Re-queue for later
    await callQueue.add('make-call', { leadId }, { delay: nextTime - Date.now() });
    return { rescheduled: true, nextCall: nextTime };
  }
  
  // PATCH 2: daily dial cap, checked right before the dial. Callbacks bypass
  // the cap (max 1 concurrent callback); everything else rolls to tomorrow.
  const isCallback = job.data.type === 'callback';
  const vertical = lead.vertical || 'commercial_auto';
  if (isCallback) {
    if (!force && (await activeCallbacks()) >= CALLBACK_CONCURRENCY) {
      await callQueue.add('make-call', { ...job.data }, {
        delay: 60000 + Math.floor(Math.random() * 30000),
        priority: 1,
        jobId: `cbwait-${leadId}-${Date.now()}`
      });
      console.log(`⏳ callback slot busy — requeued ${lead.name} in ~60-90s`);
      return { requeued: 'callback_concurrency' };
    }
  } else if (!force) {
    const dialsToday = await dialsTodayForVertical(vertical);
    if (dialsToday >= DAILY_CAP) {
      const delay = msUntilTomorrow7amET();
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: 'scheduled', scheduledCallAt: new Date(Date.now() + delay) }
      });
      await callQueue.add('make-call', { ...job.data }, {
        delay,
        priority: job.opts?.priority || 5,
        jobId: `cap-${leadId}-${Date.now()}`
      });
      console.log(`⏸️ dial cap hit for ${vertical} (${dialsToday}/${DAILY_CAP}), queue rolls to tomorrow`);
      return { requeued: 'daily_cap', dialsToday, cap: DAILY_CAP };
    }
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
  if (isCallback) await markCallbackDialing(result.callId);
  
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
  await markCallbackEnded(callId).catch(() => {}); // release callback slot (no-op for cold dials)

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

  // PATCH 1: callback outcomes make the lead ineligible for the cold queue
  if (CALLBACK_DISPOSITIONS.has(outcome.disposition)) {
    const removed = await removeQueuedCallsForLead(lead.id);
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'callback_pending' } });
    outcome.updates.status = 'callback_pending';
    console.log(`📌 ${lead.name} → callback_pending (removed ${removed} queued make-call jobs)`);
  }

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

module.exports = { handleVapiWebhook, removeQueuedCallsForLead };