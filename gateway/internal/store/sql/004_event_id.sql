-- Migration 004: event_id on audit_events for idempotent Kafka consumer inserts.
-- The consumer commits Kafka offsets only after a successful DB write; on retry
-- (redelivery) the ON CONFLICT DO NOTHING prevents duplicate rows.
-- Partial index excludes legacy NULLs so existing rows don't conflict.

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_event_id
    ON audit_events(event_id)
    WHERE event_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
