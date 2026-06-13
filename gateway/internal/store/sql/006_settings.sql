-- Migration 006: runtime gateway settings.
-- A single-row JSON document ('global') holding every dashboard-tunable knob so
-- operators can change rate limits, timeouts, ML gates and PII recognizers from
-- the control plane without a restart. The row is upserted; defaults are seeded
-- by the settings manager on first boot when the row is absent.

CREATE TABLE IF NOT EXISTS gateway_settings (
    id         TEXT PRIMARY KEY DEFAULT 'global',
    data       JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations(version) VALUES(6) ON CONFLICT DO NOTHING;
