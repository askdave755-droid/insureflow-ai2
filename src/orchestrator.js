const cron = require('node-cron');
const prisma = require('./db');
const { callQueue } = require('./queue');
const { fetchApolloContacts, fetchLeOFromSFTP } = require('./sources');
const { enrichWithFMCSA } = require('./sources/fmcsa');
const { isBusinessHours, getNextBusinessTime } = require('./lib/validate');
const config = require('./config');

const SOURCES = [
  { state: 'MI', city: 'Detroit' },
  { state: 'MI', city: 'Grand Rapids' },
  { state: 'TX', city: 'Houston' },
  { state: 'TX', city: 'Dallas' },
  { state: 'OH', city: 'Columbus' },
  { state: 'TN', city: 'Memphis' },
  { state: 'GA', city: 'Atlanta' },
  { state: 'IN', city: 'Indianapolis' },
];

async function ingestAndQueue() {
  console.log('🔄 Running lead ingestion...');
  
  const allLeads = [];
  
  // Pull from Apollo, rotating city by hour
  if (config.APOLLO_API_KEY) {
    const source = SOURCES[new Date().getHours() % SOURCES.length];
    console.log(`🌆 Apollo pull: ${source.city}, ${source.state}`);
    try {
      const apollo = await fetchApolloContacts(source.state, source.city, 50);
      allLeads.push(...apollo);
    } catch (error) {
      console.warn(`⚠️ Apollo pull failed: ${error.message}`);
    }
  }
  
  if (config.LEO_SFTP_HOST) {
    const leo = await fetchLeOFromSFTP();
    allLeads.push(...leo);
  }
  
  console.log(`📥 Ingested ${allLeads.length} leads`);
  
  let queued = 0;
  
  for (const leadData of allLeads) {
    // Skip if already exists
    const existing = await prisma.lead.findFirst({
      where: { phone: leadData.phone, status: { not: 'closed' } }
    });
    if (existing) continue;
    
    // Validate state
    if (!config.ALLOWED_STATES.includes(leadData.state)) continue;
    
    const lead = await prisma.lead.create({ data: leadData });
    
    // FMCSA enrichment — best-effort, never blocks queueing
    try {
      const fmcsa = await enrichWithFMCSA({
        name: lead.name,
        company: lead.company,
        state: lead.state,
        phone: lead.phone
      });
      if (fmcsa) {
        await prisma.lead.update({ where: { id: lead.id }, data: fmcsa });
        console.log(`🛡️ FMCSA enriched: ${lead.company || lead.name} DOT#${fmcsa.dotNumber} ${fmcsa.authorityStatus || ''}`.trim());
      }
    } catch (err) {
      console.warn(`⚠️ FMCSA enrichment failed for lead ${lead.id}: ${err.message}`);
    }
    
    // Calculate call time
    const delay = isBusinessHours(lead.state) 
      ? 5000 
      : getNextBusinessTime(lead.state) - Date.now();
    
    await callQueue.add('make-call', { leadId: lead.id }, {
      delay: Math.max(delay, 0)
    });
    
    queued++;
  }
  
  // Update daily stats
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  await prisma.dailyStat.upsert({
    where: { date: today },
    update: { leadsIngested: { increment: queued } },
    create: { date: today, leadsIngested: queued }
  });
  
  console.log(`✅ Queued ${queued} leads for calling`);
}

// Run every hour
cron.schedule('0 * * * *', ingestAndQueue);

// Also run on startup
setTimeout(ingestAndQueue, 5000);

module.exports = { ingestAndQueue };
