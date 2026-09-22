-- Apollo nurture enrollment ledger. Raw-SQL table (not a Prisma model) so it
-- does not add drift risk to the generated client. Runtime keeps this
-- self-healing too, but this versioned migration is the durable path.
CREATE TABLE IF NOT EXISTS apollo_nurture_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT NOT NULL,
  email TEXT NOT NULL,
  vertical TEXT NOT NULL,
  list_name TEXT NOT NULL,
  apollo_contact_id TEXT,
  sequence_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT,
  enrolled_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS apollo_nurture_enrollments_lead_seq_key
  ON apollo_nurture_enrollments(lead_id, sequence_id);
CREATE INDEX IF NOT EXISTS idx_apollo_nurture_email
  ON apollo_nurture_enrollments(lower(email));
CREATE INDEX IF NOT EXISTS idx_apollo_nurture_contact
  ON apollo_nurture_enrollments(apollo_contact_id);
