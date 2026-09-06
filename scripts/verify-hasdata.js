/**
 * verify-hasdata.js — ONE-TIME verification (Step 3)
 *
 * Run:  node scripts/verify-hasdata.js
 * Costs a few credits. Verifies the key works and returns HTTP 200.
 * Do not loop this — one run, check output, done.
 */
require('dotenv').config();
const axios = require('axios');

const key = process.env.HASDATA_API_KEY;
if (!key) {
    console.error('HASDATA_API_KEY not set in .env');
    process.exit(1);
}

(async () => {
    try {
        const r = await axios.post('https://api.hasdata.com/scrape/web',
            { url: 'https://example.com', extractRules: { title: 'h1' } },
            { headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, timeout: 30000 }
        );
        console.log('HTTP', r.status, '— key valid, HasData reachable');
        const t = r.data?.extractedData?.title || JSON.stringify(r.data).slice(0, 120);
        console.log('Scraped content sample:', t);
    } catch (e) {
        console.error('FAILED —', e.response?.status, JSON.stringify(e.response?.data || e.message).slice(0, 200));
        process.exit(1);
    }
})();
