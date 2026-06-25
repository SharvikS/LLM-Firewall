-- Migration 012: control-plane audit metadata.
-- These nullable columns let admin/auth actions share the same audit_events
-- table as request-path events while preserving actor and target context for
-- compliance review and SIEM export.

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_id TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_email TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_role TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_type TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS target_type TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS target_id TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS source_ip TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS user_agent TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_actor_email_created
    ON audit_events(actor_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_target_created
    ON audit_events(target_type, target_id, created_at DESC);

INSERT INTO schema_migrations(version) VALUES(12) ON CONFLICT DO NOTHING;
