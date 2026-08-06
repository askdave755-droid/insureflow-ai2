const axios = require('axios');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const SftpClient = require('ssh2-sftp-client');
const config = require('../config');
const { formatPhoneE164 } = require('../lib/validate');

// ─── APOLLO.IO API ───
async function fetchApolloContacts(state, city, limit = 100) {
  if (!config.APOLLO_API_KEY) return [];
  
  try {
    const response = await axios.post(
      'https://api.apollo.io/v1/mixed_people/search',
      {
        api_key: config.APOLLO_API_KEY,
        person_titles: ['Owner', 'President', 'CEO', 'Fleet Manager', 'General Manager'],
        person_locations: [`${city}, ${state}, United States`],
        organization_industries: ['Trucking', 'Transportation', 'Logistics', 'Freight'],
        contact_email_status: ['verified'],
        phone_numbers: ['has_mobile_phone'],
        per_page: limit
      },
      { timeout: 15000 }
    );
    
    return (response.data.people || []).map(p => ({
      name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
      phone: formatPhoneE164(p.phone_numbers?.[0]?.raw_number || p.mobile_phone),
      email: p.email,
      company: p.organization?.name,
      title: p.title,
      state,
      city,
      source: 'apollo',
      insuranceType: 'commercial_auto',
      industry: p.organization?.industry
    })).filter(l => l.phone && l.name);
  } catch (error) {
    console.error('Apollo fetch failed:', error.message);
    return [];
  }
}

// ─── FMCSA API ───
async function fetchFMCSANewFilings(state) {
  // FMCSA doesn't have a simple REST API for new filings without registration.
  // Alternative: Download their monthly snapshot CSV and parse.
  // For now, return empty or implement if you have API access.
  console.log('FMCSA source: Implement CSV snapshot download or API key');
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
