-- Migration 004: event_id on audit_events for idempotent Kafka consumer inserts.
-- The consumer commits Kafka offsets only after a successful DB write; on retry
-- (redelivery) the ON CONFLICT DO NOTHING prevents duplicate rows.
--
-- The unique index lives in 004b_event_id_index.sql: CockroachDB cannot create
-- an index on a column added in the same implicit transaction ("column is not
-- public"), and migrate() runs each file as its own Exec/transaction.

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_id TEXT;

INSERT INTO schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
