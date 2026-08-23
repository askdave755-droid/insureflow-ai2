// ─── PIPELINE / STATUS ARCHITECTURE (Phase 1) ────────────────────────
// Canonical stage definitions and legal transitions. Every stage change
// goes through assertTransition() so the pipeline can't be silently
// corrupted by a stray update.
//
// Lead (acquisition)  : pending → scheduled → calling → called → qualified → converted → closed
// Opportunity (sales) : NEW → QUALIFIED → RISK_PROFILED → SUBMITTED → QUOTED → PROPOSAL → BIND_PENDING → BOUND
// Submission          : DRAFT → READY → SUBMITTED → UNDER_REVIEW → QUOTED
// Quote               : RECEIVED → PRESENTED → ACCEPTED
// Policy              : ACTIVE → (PENDING_CANCEL → CANCELLED) | EXPIRED | NON_RENEWED
// Renewal             : NOT_STARTED → CONTACTED → RE_MARKETING → QUOTED → PROPOSAL → BOUND

const TRANSITIONS = {
  Opportunity: {
    NEW:           ['QUALIFIED', 'LOST', 'NURTURE'],
    QUALIFIED:     ['RISK_PROFILED', 'SUBMITTED', 'LOST', 'NURTURE'],
    RISK_PROFILED: ['SUBMITTED', 'LOST', 'NURTURE'],
    SUBMITTED:     ['QUOTED', 'LOST'],
    QUOTED:        ['PROPOSAL', 'LOST'],
    PROPOSAL:      ['BIND_PENDING', 'LOST'],
    BIND_PENDING:  ['BOUND', 'LOST'],
    BOUND:         [],
    LOST:          ['NEW'],          // reopen
    NURTURE:       ['NEW', 'QUALIFIED']
  },
  Submission: {
    DRAFT:        ['READY', 'WITHDRAWN'],
    READY:        ['SUBMITTED', 'WITHDRAWN'],
    SUBMITTED:    ['UNDER_REVIEW', 'DECLINED', 'WITHDRAWN'],
    UNDER_REVIEW: ['QUOTED', 'DECLINED'],
    QUOTED:       [],
    DECLINED:     ['READY'],         // resubmit
    WITHDRAWN:    []
  },
  Quote: {
    RECEIVED:  ['PRESENTED', 'DECLINED', 'EXPIRED'],
    PRESENTED: ['ACCEPTED', 'DECLINED', 'EXPIRED'],
    ACCEPTED:  [],
    DECLINED:  [],
    EXPIRED:   []
  },
  Policy: {
    ACTIVE:         ['PENDING_CANCEL', 'EXPIRED', 'NON_RENEWED'],
    PENDING_CANCEL: ['CANCELLED', 'ACTIVE'],
    CANCELLED:      [],
    EXPIRED:        [],
    NON_RENEWED:    []
  },
  Renewal: {
    NOT_STARTED:  ['CONTACTED', 'LOST'],
    CONTACTED:    ['RE_MARKETING', 'QUOTED', 'LOST'],
    RE_MARKETING: ['QUOTED', 'LOST'],
    QUOTED:       ['PROPOSAL', 'LOST'],
    PROPOSAL:     ['BOUND', 'LOST'],
    BOUND:        [],
    LOST:         []
  }
};

function canTransition(entityType, from, to) {
  const table = TRANSITIONS[entityType];
  if (!table) return false;
  return (table[from] || []).includes(to);
}

function assertTransition(entityType, from, to) {
  if (from === to) return; // no-op is always fine
  if (!canTransition(entityType, from, to)) {
    const allowed = (TRANSITIONS[entityType] || {})[from] || [];
    throw new Error(
      `Illegal ${entityType} stage transition: ${from} → ${to}. Allowed from ${from}: [${allowed.join(', ') || 'none'}]`
    );
  }
}

module.exports = { TRANSITIONS, canTransition, assertTransition };
