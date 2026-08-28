// ─── SMOKE TEST (npm test) ───────────────────────────────────────────
// Imports PURE libraries only (config, tenancy, instantly) and asserts key
// exports plus pure-function behavior. Does NOT boot the server, Redis,
// queues, or the database — safe to run anywhere.
const assert = require('assert');

let failures = 0;
const pending = [];
function check(name, fn) {
  const run = Promise.resolve()
    .then(fn)
    .then(() => console.log(`✅ ${name}`))
    .catch((err) => {
      failures += 1;
      console.error(`❌ ${name}: ${err.message}`);
    });
  pending.push(run);
}

// ─── config ──────────────────────────────────────────────────────────
const config = require('../src/config');

check('config: Phase 1 env keys exist', () => {
  for (const key of [
    'DEFAULT_CLIENT_ID', 'DEFAULT_CLIENT_SLUG', 'ALLOW_NUCLEAR_RESET',
    'BREVO_WEBHOOK_SECRET', 'INSTANTLY_API_KEY', 'INSTANTLY_API_BASE_URL',
    'INSTANTLY_WEBHOOK_SECRET', 'INSTANTLY_PUSH_ENABLED'
  ]) {
    assert(Object.prototype.hasOwnProperty.call(config, key), `missing config key ${key}`);
  }
});

check('config: INSTANTLY_API_BASE_URL defaults to https://api.instantly.ai/api/v1', () => {
  delete process.env.INSTANTLY_API_BASE_URL;
  assert.strictEqual(config.INSTANTLY_API_BASE_URL, 'https://api.instantly.ai/api/v1');
});

check('config: INSTANTLY_PUSH_ENABLED defaults to false-ish', () => {
  assert.notStrictEqual(config.INSTANTLY_PUSH_ENABLED, 'true');
});

// ─── tenancy ─────────────────────────────────────────────────────────
const tenancy = require('../src/lib/tenancy');

check('tenancy: exports lookup/config/state helpers', () => {
  for (const fn of ['getClientById', 'getClientBySlug', 'getDefaultClient', 'getClientRuntimeConfig', 'assertClientStateAllowed']) {
    assert.strictEqual(typeof tenancy[fn], 'function', `missing tenancy.${fn}`);
  }
});

check('tenancy: runtime config falls back to env config for null client', () => {
  const rc = tenancy.getClientRuntimeConfig(null);
  assert.strictEqual(rc.clientId, null);
  assert.strictEqual(rc.vapiAssistantId, config.VAPI_ASSISTANT_ID);
  assert.strictEqual(rc.vapiPhoneNumberId, config.VAPI_PHONE_NUMBER_ID);
  assert.strictEqual(rc.calendlyLink, config.CALENDLY_LINK);
  assert.deepStrictEqual(rc.licensedStates, config.ALLOWED_STATES);
});

check('tenancy: runtime config prefers per-client overrides', () => {
  const client = {
    id: 'c1', slug: 'acme', name: 'Acme',
    vapiAssistantId: 'asst_x', vapiPhoneNumberId: 'pn_x',
    calendlyLink: 'https://calendly.com/acme',
    brevoSenderName: 'Acme', brevoSenderEmail: 'hi@acme.test',
    brandingJson: { color: 'red' },
    licensedStates: ['OH', 'IN']
  };
  const rc = tenancy.getClientRuntimeConfig(client);
  assert.strictEqual(rc.vapiAssistantId, 'asst_x');
  assert.strictEqual(rc.brevoSenderEmail, 'hi@acme.test');
  assert.deepStrictEqual(rc.licensedStates, ['OH', 'IN']);
});

check('tenancy: assertClientStateAllowed gates per-client and legacy states', () => {
  assert.strictEqual(tenancy.assertClientStateAllowed({ licensedStates: ['OH'] }, 'oh'), true);
  assert.strictEqual(tenancy.assertClientStateAllowed({ licensedStates: ['OH'] }, 'TX'), false);
  assert.strictEqual(tenancy.assertClientStateAllowed({ licensedStates: [] }, 'MI'), config.ALLOWED_STATES.includes('MI'));
  assert.strictEqual(tenancy.assertClientStateAllowed(null, 'MI'), config.ALLOWED_STATES.includes('MI'));
  assert.strictEqual(tenancy.assertClientStateAllowed(null, null), false);
});

// ─── instantly ───────────────────────────────────────────────────────
const instantly = require('../src/lib/instantly');

check('instantly: exports contract functions', () => {
  for (const fn of ['instantlyConfigured', 'normalizeInstantlyEvent', 'upsertAgencyProspectFromEvent', 'pushAgencyProspect']) {
    assert.strictEqual(typeof instantly[fn], 'function', `missing instantly.${fn}`);
  }
  assert(Array.isArray(instantly.AGENCY_PROSPECT_STATUSES));
});

check('instantly: configured() is bool and false without API key', () => {
  assert.strictEqual(typeof instantly.instantlyConfigured(), 'boolean');
  if (!process.env.INSTANTLY_API_KEY) {
    assert.strictEqual(instantly.instantlyConfigured(), false);
  }
});

check('instantly: normalizes nested { lead, event_type } shape', () => {
  const ev = instantly.normalizeInstantlyEvent({
    event_type: 'email_replied',
    campaign_id: 'camp_1',
    lead: { email: 'Agent@Example.com', first_name: 'Ada', last_name: 'Lovelace', company_name: 'Acme Insurance', state: 'MI' }
  });
  assert.strictEqual(ev.email, 'agent@example.com');
  assert.strictEqual(ev.firstName, 'Ada');
  assert.strictEqual(ev.agencyName, 'Acme Insurance');
  assert.strictEqual(ev.status, 'replied');
  assert.strictEqual(ev.instantlyCampaignId, 'camp_1');
  assert.strictEqual(ev.lastEvent, 'email_replied');
});

check('instantly: normalizes flat shape with explicit status', () => {
  const ev = instantly.normalizeInstantlyEvent({
    email: 'flat@example.com', first_name: 'Flat', campaign_id: 'camp_2', status: 'qualified', lead_id: 'lead_9'
  });
  assert.strictEqual(ev.email, 'flat@example.com');
  assert.strictEqual(ev.status, 'qualified');
  assert.strictEqual(ev.instantlyLeadId, 'lead_9');
});

check('instantly: unknown event keeps status null; missing email returns null', () => {
  const ev = instantly.normalizeInstantlyEvent({ event_type: 'campaign_completed', lead: { email: 'a@b.co' } });
  assert.strictEqual(ev.status, null);
  assert.strictEqual(instantly.normalizeInstantlyEvent({ event_type: 'email_replied' }), null);
  assert.strictEqual(instantly.normalizeInstantlyEvent(null), null);
});

check('instantly: outbound push is a disabled no-op unless explicitly enabled', async () => {
  const result = await instantly.pushAgencyProspect({ email: 'x@y.z' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.skipped, true);
});

// ─── done ────────────────────────────────────────────────────────────
Promise.all(pending).then(() => {
  if (failures > 0) {
    console.error(`\n${failures} smoke check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll smoke checks passed ✔');
});
