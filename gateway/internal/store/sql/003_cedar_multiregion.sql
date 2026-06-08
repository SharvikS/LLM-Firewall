-- Migration 003: Cedar policy text + region tagging
-- Cedar-generated policy text stored alongside structured fields for audit/debugging.
-- Region column on audit_events enables geo-aware querying without geo-partitioning
-- (enterprise CockroachDB feature not required for local/single-node topology).

ALTER TABLE policies      ADD COLUMN IF NOT EXISTS cedar_text TEXT;
ALTER TABLE audit_events  ADD COLUMN IF NOT EXISTS region     TEXT NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS idx_audit_region ON audit_events(region, created_at DESC);

INSERT INTO schema_migrations(version) VALUES(3) ON CONFLICT DO NOTHING;
