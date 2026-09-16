// ─── NEXUS CHAT WIDGET INTAKE ─────────────────────────────────────
// Receives leads from the nexus-chat.html website widget (POST /webhook/nexus-chat).
// The widget duplicates the VAPI qualification flow in chat form on
// nexusgpartners.net — leads arrive already lane='WEB', source='nexus_chat'.
//
// Routing:
//   commercial   -> commercial_auto pipeline (pending; Brady call queue if
//                   business hours, else scheduled next open)
//   everything else (term_life, disability, unknown) -> life_fe pending,
//                   queued the same way — these are inbound WARM leads,
//                   they jump the line ahead of scraped leads (priority 1)
const prisma = require('./db');
const { callQueue } = require('./queue');
const { formatPhoneE164, isBusinessHours, getNextBusinessTime } = require('./lib/validate');
const { createTask } = require('./lib/followup');
const { brevoEmail } = require('./lib/brevo');

const PRODUCT_LABELS = {
  term_life: 'Term life',
  disability: 'Disability income',
  commercial: 'Commercial / trucking',
  unknown: 'Coverage review'
};

async function handleNexusChatLead(body) {
  const b = body || {};
  if (!b.phone) return { ok: false, reason: 'no_phone' };
  const phone = formatPhoneE164(b.phone);
  if (!phone) return { ok: false, reason: 'bad_phone' };

  const product = PRODUCT_LABELS[b.product] ? b.product : 'unknown';
  const vertical = product === 'commercial' ? 'commercial_auto' : 'life_fe';

  // Dedupe: same phone, still open -> merge notes instead of double-queueing
  const existing = await prisma.lead.findFirst({
    where: { phone, status: { notIn: ['closed', 'compliance_hold', 'converted'] } }
  });
  if (existing) {
    console.log(`💬 Nexus chat: dedupe hit for ${phone} (lead ${existing.id}) — not double-queueing`);
    return { ok: true, deduped: true, leadId: existing.id };
  }

  let zip = null;
  if (b.zip && /^\d{5}$/.test(String(b.zip))) zip = String(b.zip);

  const notes = [
    `Product: ${PRODUCT_LABELS[product]}`,
    b.age ? `Age: ${b.age}` : null,
    b.tobacco ? `Tobacco: ${b.tobacco}` : null,
    b.coverage ? `Coverage requested: $${(+b.coverage).toLocaleString()}` : null,
    b.term ? `Term: ${b.term}yr` : null,
    zip ? `ZIP: ${zip}` : null,
    `Captured: ${b.captured_at || new Date().toISOString()}`
  ].filter(Boolean).join(' | ');

  const lead = await prisma.lead.create({
    data: {
      name: b.name || 'Web Lead',
      phone,
      email: b.email || null,
      state: 'MI', // widget is on a Michigan-licensed site; ZIP noted in transcript
      insuranceType: vertical === 'life_fe' ? 'life' : 'commercial_auto',
      vertical,
      source: 'nexus_chat',
      status: 'pending',
      transcript: notes
    }
  });

  // Inbound warm lead — front of the call queue (priority 1), business-hours aware
  let queued = false;
  if (isBusinessHours(lead.state)) {
    await callQueue.add('make-call', { leadId: lead.id }, { delay: 60000, priority: 1, jobId: 'nxq-' + lead.id });
    queued = true;
  } else {
    const nextTime = getNextBusinessTime(lead.state);
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'scheduled', scheduledCallAt: nextTime } });
    await callQueue.add('make-call', { leadId: lead.id }, { delay: Math.max(nextTime - Date.now(), 60000), priority: 1, jobId: 'nxq-' + lead.id });
    queued = true;
  }

  await createTask({
    leadId: lead.id,
    type: 'FOLLOW_UP',
    title: `💬 Inbound web lead: ${lead.name} — ${PRODUCT_LABELS[product]}`,
    notes,
    dueAt: new Date(Date.now() + 3600000),
    priority: 'hot'
  });

  const alertTo = process.env.DAVE_ALERT_EMAIL;
  if (alertTo) {
    brevoEmail(
      alertTo,
      `💬 Inbound web lead: ${lead.name} (${PRODUCT_LABELS[product]})`,
      `<p>Someone just completed the Nexus chat quote widget:</p>
       <p><b>${lead.name}</b><br>${phone}<br>${lead.email || 'no email'}</p>
       <p>${notes}</p>
       <p>Brady's call is ${queued ? 'queued' : 'scheduled'} — warm inbound, handle fast.</p>`
    ).catch(err => console.error('⚠️ Nexus chat alert email failed:', err.message));
  }

  console.log(`💬 Nexus chat lead: ${lead.name} (${PRODUCT_LABELS[product]}) -> ${vertical}, queued=${queued}`);
  return { ok: true, leadId: lead.id, vertical, queued };
}

module.exports = { handleNexusChatLead };
