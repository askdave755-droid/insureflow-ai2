// ─── AUDIT TRAIL (Phase 1) ───────────────────────────────────────────
// Every meaningful mutation leaves a row in audit_logs: who, what changed,
// before/after snapshots, request context. Audit failure never breaks the
// business operation (but logs loudly).
const prisma = require('../db');

async function audit({ actor = 'system', action, entityType, entityId, before = null, after = null, req = null, metadata = null }) {
  try {
    const meta = { ...(metadata || {}) };
    if (req) {
      meta.ip = req.ip || req.headers['x-forwarded-for'] || null;
      meta.userAgent = req.headers['user-agent'] || null;
      meta.path = req.originalUrl || req.path || null;
    }
    await prisma.auditLog.create({
      data: {
        actor,
        action,
        entityType,
        entityId: String(entityId),
        before: before === null ? undefined : before,
        after: after === null ? undefined : after,
        metadata: Object.keys(meta).length ? meta : undefined
      }
    });
  } catch (err) {
    console.error(`❌ AUDIT WRITE FAILED (${action} ${entityType}:${entityId}):`, err.message);
  }
}

// Express middleware: attach req.audit = (entry) => audit({...entry, req})
function auditMiddleware(defaultActor = 'system') {
  return (req, res, next) => {
    req.audit = (entry) => audit({ ...entry, req, actor: entry.actor || defaultActor });
    next();
  };
}

module.exports = { audit, auditMiddleware };
