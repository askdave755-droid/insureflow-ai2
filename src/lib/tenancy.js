// ─── PHASE 1 TENANCY ─────────────────────────────────────────────────
// Thin clientId tenancy helpers. Phase 1 supports a single agency plus a
// handful of manually-managed insurance-agent clients. Anywhere clientId is
// null we fall back to the legacy single-agency env/config behavior — nothing
// in the existing system breaks when no Client rows exist.
//
// Prisma is required lazily so this module is importable in smoke tests
// without a generated client, live DB, Redis, or server boot.
const config = require('../config');

function db() {
  // Lazy require — keeps `require('./tenancy')` side-effect free.
  return require('../db');
}

// ─── Lookups ─────────────────────────────────────────────────────────
// All lookups return null (never throw) when the client is missing or the
// lookup input is empty; DB errors propagate to the caller.

async function getClientById(clientId) {
  if (!clientId) return null;
  return db().client.findUnique({ where: { id: clientId } });
}

async function getClientBySlug(slug) {
  if (!slug) return null;
  return db().client.findUnique({ where: { slug } });
}

// Default client from DEFAULT_CLIENT_ID (preferred) or DEFAULT_CLIENT_SLUG.
// Returns null when neither is configured or no matching active client exists.
async function getDefaultClient() {
  if (config.DEFAULT_CLIENT_ID) {
    const client = await db().client.findUnique({ where: { id: config.DEFAULT_CLIENT_ID } });
    if (client && client.active) return client;
  }
  if (config.DEFAULT_CLIENT_SLUG) {
    const client = await db().client.findUnique({ where: { slug: config.DEFAULT_CLIENT_SLUG } });
    if (client && client.active) return client;
  }
  return null;
}

// ─── Runtime config resolution ───────────────────────────────────────
// Per-client overrides for outreach runtime config. Every field falls back
// to the existing env/config value when the client is null (legacy behavior)
// or leaves the field unset.
function getClientRuntimeConfig(client) {
  const licensedStates = Array.isArray(client?.licensedStates) && client.licensedStates.length > 0
    ? client.licensedStates
    : config.ALLOWED_STATES;
  return {
    clientId: client?.id || null,
    clientSlug: client?.slug || null,
    clientName: client?.name || null,
    vapiAssistantId: client?.vapiAssistantId || config.VAPI_ASSISTANT_ID,
    vapiPhoneNumberId: client?.vapiPhoneNumberId || config.VAPI_PHONE_NUMBER_ID,
    calendlyLink: client?.calendlyLink || config.CALENDLY_LINK,
    brevoSenderName: client?.brevoSenderName || null,
    brevoSenderEmail: client?.brevoSenderEmail || config.EMAIL_FROM,
    branding: client?.brandingJson || null,
    licensedStates
  };
}

// ─── State gating ────────────────────────────────────────────────────
// True when `state` is within the client's licensed states; falls back to
// the agency-wide ALLOWED_STATES for null/default clients.
function assertClientStateAllowed(client, state) {
  if (!state) return false;
  const { licensedStates } = getClientRuntimeConfig(client);
  return licensedStates.includes(String(state).toUpperCase());
}

module.exports = {
  getClientById,
  getClientBySlug,
  getDefaultClient,
  getClientRuntimeConfig,
  assertClientStateAllowed
};
