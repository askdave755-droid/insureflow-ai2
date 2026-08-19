// ============================================
// CARRIER ROUTES - src/routes-carrier.js
// Wired up in server.js via attachCarrierRoutes(app, pool)
// ============================================

const { matchCarriers, getCarrierNames, getTopCarriersForLead } = require('./lib/carriers');
const { sendQualificationFollowUp } = require('./lib/messaging');

function attachCarrierRoutes(app, pool) {

  // List carriers by state
  app.get('/api/carriers', (req, res) => {
    const { state } = req.query;
    const names = state ? getCarrierNames(state) : [];
    res.json({ count: names.length, carriers: names });
  });

  // Match carriers for a risk profile
  app.post('/api/match-carriers', (req, res) => {
    try {
      const result = matchCarriers(req.body);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Admin diagnosis page for a lead
  app.get('/admin/carrier-match/:leadId', async (req, res) => {
    const lead = await pool.query('SELECT * FROM leads WHERE id = $1', [req.params.leadId]);
    if (!lead.rows[0]) return res.status(404).send('Lead not found');

    const l = lead.rows[0];
    const data = matchCarriers({
      state: l.state,
      vertical: l.industry || 'trucking',
      vehicle_count: l.vehicle_count || 1,
      has_hazmat: l.hazmat || false,
      has_dui: l.has_dui || false,
      dui_months_ago: l.dui_months_ago || null,
      revenue: l.revenue || 0,
      years_in_business: l.years_in_business || 0
    });

    res.send(`<!DOCTYPE html>
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body{font-family:-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;padding:20px;margin:0}
      h2{color:#f59e0b;margin-top:0}
      .card{background:#1e293b;border-radius:12px;padding:16px;margin:12px 0}
      .instant{border-left:4px solid #22c55e}.fast{border-left:4px solid #3b82f6}
      .standard{border-left:4px solid #f59e0b}.declined{border-left:4px solid #ef4444}
      .carrier-name{font-weight:700;font-size:16px;color:#fff}
      .reasons{font-size:12px;color:#94a3b8;margin-top:4px}
      .tag{display:inline-block;background:#334155;padding:2px 8px;border-radius:4px;font-size:11px;margin-right:4px}
      .top-pick{background:#f59e0b;color:#0f172a;padding:4px 12px;border-radius:6px;font-weight:700;display:inline-block;margin-bottom:8px}
    </style></head><body>
    <h2>🎯 Carrier Diagnosis</h2>
    <div class="card">
      <p><strong>${l.company || l.name}</strong></p>
      <p>${l.state} | ${l.vehicle_count || '?'} vehicles | ${l.industry || 'Unknown'}</p>
      ${l.has_dui ? '<span class="tag" style="background:#ef4444;color:#fff">DUI on record</span>' : ''}
      ${l.hazmat ? '<span class="tag" style="background:#f59e0b;color:#000">Hazmat</span>' : ''}
    </div>
    <h3 style="color:#22c55e">✅ Will Write (${data.match_count} carriers)</h3>
    ${data.all_matches.map((c,i) => `
      <div class="card ${c.instant_bind ? 'instant' : c.quote_turnaround_hours <= 24 ? 'fast' : 'standard'}">
        ${i === 0 ? '<span class="top-pick">TOP PICK</span>' : ''}
        <div class="carrier-name">${c.carrier_name}</div>
        <div class="reasons">${c.match_reasons?.join(' • ') || 'Appetite match'}</div>
        <div style="margin-top:8px;font-size:13px;color:#cbd5e1">${c.notes}</div>
        <div style="margin-top:6px">
          <span class="tag">${c.instant_bind ? '⚡ Instant Bind' : c.quote_turnaround_hours + 'hr quote'}</span>
          <span class="tag">${c.lines?.slice(0,2).join(', ')}</span>
          ${c.dui_lookback_months ? `<span class="tag">DUI: ${c.dui_lookback_months/12}yr</span>` : '<span class="tag" style="background:#ef4444;color:#fff">No DUI</span>'}
        </div>
      </div>
    `).join('')}
    ${data.match_count === 0 ? '<div class="card declined"><p>No carriers match this risk. Consider E&S market or referral.</p></div>' : ''}
    </body></html>`);
  });
}

module.exports = { attachCarrierRoutes };
