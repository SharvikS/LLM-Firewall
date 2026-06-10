-- Migration 004b: unique index for idempotent audit inserts (split from 004
-- so the event_id column is public before the index references it — required
-- by CockroachDB). Partial index excludes legacy NULLs so existing rows don't
-- conflict.

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_event_id
    ON audit_events(event_id)
    WHERE event_id IS NOT NULL;
