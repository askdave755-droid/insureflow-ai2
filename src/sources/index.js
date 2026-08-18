const axios = require('axios');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const SftpClient = require('ssh2-sftp-client');
const config = require('../config');
const { formatPhoneE164 } = require('../lib/validate');

// ─── APOLLO.IO API ───
// Current spec (2025-2026):
//   Search:   POST https://api.apollo.io/api/v1/mixed_people/api_search
//             Auth via 'X-Api-Key' header. Filters: person_titles[], person_locations[],
//             q_keywords, per_page, page. NOTE: search does NOT return emails/phones.
//   Enrich:   POST https://api.apollo.io/api/v1/people/bulk_match (up to 10 per call)
//             Returns emails/phones; reveal_phone_number requires a webhook_url and a
//             paid plan, so we only use synchronously returned data and handle
//             402/403 (plan limits) gracefully.
const APOLLO_HEADERS = () => ({
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache',
  'X-Api-Key': config.APOLLO_API_KEY
});

function logApolloError(context, err) {
  const status = err.response?.status;
  const data = err.response?.data;
  if (status === 402 || status === 403) {
    console.warn(`Apollo plan limit (${context}):`, status, JSON.stringify(data || err.message));
  } else {
    console.error(`Apollo ${context} failed:`, status, JSON.stringify(data || err.message));
  }
}

async function enrichApolloPeople(people) {
  // Bulk-enrich in batches of 10 to retrieve emails/phones. Skip on plan limits.
  const enriched = new Map();
  for (let i = 0; i < people.length; i += 10) {
    const batch = people.slice(i, i + 10);
    try {
      const res = await axios.post(
        'https://api.apollo.io/api/v1/people/bulk_match',
        {
          details: batch.map(p => ({
            id: p.id,
            first_name: p.first_name,
            last_name: p.last_name,
            organization_name: p.organization?.name
          }))
        },
        { headers: APOLLO_HEADERS(), timeout: 20000 }
      );
      for (const match of (res.data.matches || [])) {
        if (match && match.id) enriched.set(match.id, match);
      }
    } catch (err) {
      logApolloError('enrichment', err);
      if (err.response?.status === 402 || err.response?.status === 403) break; // plan limit — stop enriching
    }
  }
  return enriched;
}

async function fetchApolloContacts(state, city, limit = 100) {
  if (!config.APOLLO_API_KEY) return [];

  try {
    const response = await axios.post(
      'https://api.apollo.io/api/v1/mixed_people/api_search',
      {
        person_titles: ['Owner', 'President', 'CEO', 'Fleet Manager', 'Operations Manager'],
        person_locations: [`${city}, ${state}, US`],
        q_keywords: 'trucking logistics freight transportation',
        per_page: Math.min(limit, 100),
        page: 1
      },
      { headers: APOLLO_HEADERS(), timeout: 15000 }
    );

    const people = response.data.people || [];
    if (!people.length) {
      console.log(`Apollo search: 0 results for ${city}, ${state}`);
      return [];
    }

    // Search results don't include phones/emails — enrich to get them.
    const enriched = await enrichApolloPeople(people);

    const leads = people.map(p => {
      const e = enriched.get(p.id) || {};
      const phone = formatPhoneE164(
        e.phone_numbers?.[0]?.sanitized_number ||
        e.phone_numbers?.[0]?.raw_number ||
        e.organization?.primary_phone?.sanitized_number ||
        e.organization?.phone ||
        p.organization?.primary_phone?.sanitized_number ||
        p.organization?.phone
      );
      return {
        name: `${p.first_name || ''} ${p.last_name || e.last_name || ''}`.trim(),
        phone,
        email: e.email || p.email,
        company: p.organization?.name || e.organization?.name,
        title: p.title || e.title,
        state,
        city,
        source: 'apollo',
        insuranceType: 'commercial_auto',
        industry: p.organization?.industry || e.organization?.industry
      };
    }).filter(l => l.phone && l.name);

    console.log(`Apollo search: ${people.length} found, ${leads.length} with phone for ${city}, ${state}`);
    return leads;
  } catch (error) {
    console.error('Apollo fetch failed:', error.response?.status, JSON.stringify(error.response?.data || error.message));
    return [];
  }
}

// ─── FMCSA API ───
// NOTE: superseded as a lead SOURCE — FMCSA is now used to ENRICH leads at
// ingestion time (see src/sources/fmcsa.js → enrichWithFMCSA, wired into the
// orchestrator loop and the Phantom webhook). This stub remains for export
// compatibility.
async function fetchFMCSANewFilings(state) {
  console.log('FMCSA source: superseded by FMCSA enrichment (src/sources/fmcsa.js)');
  return [];
}

// ─── leO SFTP AUTO-IMPORT ───
async function fetchLeOFromSFTP() {
  if (!config.LEO_SFTP_HOST) return [];
  
  const sftp = new SftpClient();
  const leads = [];
  
  try {
    await sftp.connect({
      host: config.LEO_SFTP_HOST,
      username: config.LEO_SFTP_USER,
      password: config.LEO_SFTP_PASS
    });
    
    const files = await sftp.list('/exports');
    const csvFiles = files.filter(f => f.name.endsWith('.csv'));
    
    for (const file of csvFiles) {
      const remotePath = `/exports/${file.name}`;
      const localPath = path.join('/tmp', file.name);
      await sftp.get(remotePath, localPath);
      
      // Parse CSV
      await new Promise((resolve, reject) => {
        fs.createReadStream(localPath)
          .pipe(csv())
          .on('data', (row) => {
            const phone = formatPhoneE164(row.phone || row.Phone || row.PHONE);
            if (!phone) return;
            
            leads.push({
              name: `${row.first_name || row.FirstName || ''} ${row.last_name || row.LastName || ''}`.trim(),
              phone,
              email: row.email || row.Email,
              company: row.company || row.CompanyName,
              title: row.title || row.JobTitle,
              state: (row.state || row.State || 'MI').toUpperCase(),
              city: row.city || row.City,
              insuranceType: row.insurance_type || 'commercial_auto',
              source: 'leo',
              xDate: row.x_date || row.renewal_date ? new Date(row.x_date || row.renewal_date) : null,
              currentCarrier: row.current_carrier || row.Carrier,
              workersCompMod: row.wc_mod ? parseFloat(row.wc_mod) : null,
              vehicleCount: row.vehicle_count ? parseInt(row.vehicle_count) : null,
              employeeCount: row.employee_count ? parseInt(row.employee_count) : null,
              revenue: row.revenue ? parseInt(row.revenue) : null,
              naicsCode: row.naics_code || row.naics
            });
          })
          .on('end', resolve)
          .on('error', reject);
      });
      
      // Archive processed file
      await sftp.rename(remotePath, `/exports/processed/${file.name}`);
      fs.unlinkSync(localPath);
    }
    
    await sftp.end();
  } catch (error) {
    console.error('leO SFTP failed:', error.message);
  }
  
  return leads;
}

// ─── PHANTOM BUSTER WEBHOOK BUFFER ───
// This receives webhooks and stores them. The orchestrator picks them up.
async function fetchPhantomResults() {
  // Phantom results are pushed via webhook to /webhook/phantom
  // This function would query a temporary store or return []
  return [];
}

module.exports = {
  fetchApolloContacts,
  fetchFMCSANewFilings,
  fetchLeOFromSFTP,
  fetchPhantomResults
};
