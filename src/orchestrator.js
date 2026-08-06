const cron = require('node-cron');
const prisma = require('./db');
const { callQueue } = require('./queue');
const { fetchApolloContacts, fetchLeOFromSFTP } = require('./sources');
const { isBusinessHours, getNextBusinessTime } = require('./lib/validate');
const config = require('./config');

async function ingestAndQueue() {
  console.log('🔄 Running lead ingestion...');
  
  const allLeads = [];
  
  // Pull from all sources
  if (config.APOLLO_API_KEY) {
    const apollo = await fetchApolloContacts('TX', 'Houston', 50);
    allLeads.push(...apollo);
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
