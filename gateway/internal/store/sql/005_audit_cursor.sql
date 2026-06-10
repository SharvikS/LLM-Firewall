-- Migration 005: keyset (cursor) pagination support for audit_events.
-- Composite indexes let `WHERE (created_at, id) < ($1, $2)` seek directly
-- instead of scanning + skipping OFFSET rows. id is the tie-breaker for
-- events sharing a created_at timestamp.

CREATE INDEX IF NOT EXISTS idx_audit_created_id
    ON audit_events(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_created_id
    ON audit_events(tenant_id, created_at DESC, id DESC);

INSERT INTO schema_migrations(version) VALUES(5) ON CONFLICT DO NOTHING;
