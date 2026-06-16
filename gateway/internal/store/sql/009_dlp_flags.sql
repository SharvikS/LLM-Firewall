-- Migration 009: endpoint-side DLP violations + repeat-offender flags.
--
-- Every non-clean browser-DLP event (a user trying to push PII/secrets/injection
-- into ChatGPT/Claude/Gemini) is recorded as a violation, keyed by a stable
-- subject (the extension's install id, or the detected account email). When a
-- subject crosses the configured threshold a flag is raised so the admin sees
-- the repeat offender on the main portal. Metadata only — never prompt text.

CREATE TABLE IF NOT EXISTS dlp_violations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject      TEXT NOT NULL,                 -- stable identity (install id / account email)
    account      TEXT NOT NULL DEFAULT '',      -- best-effort human identity (email/name)
    site         TEXT NOT NULL DEFAULT '',      -- chatgpt | claude | gemini
    action       TEXT NOT NULL,                 -- BROWSER_DLP_BLOCK | _REDACT | _OVERRIDE
    risk         FLOAT NOT NULL DEFAULT 0,
    categories   TEXT NOT NULL DEFAULT '',      -- comma-joined: pii,secret,injection,…
    reason       TEXT NOT NULL DEFAULT '',
    source       TEXT NOT NULL DEFAULT '',      -- engine | local
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dlp_violations_subject ON dlp_violations(subject, created_at);
CREATE INDEX IF NOT EXISTS idx_dlp_violations_created ON dlp_violations(created_at);

-- One row per subject that has crossed the threshold. status='open' until an
-- admin acknowledges it. violation_count / last_* are bumped on each new
-- violation so the portal shows live severity without re-aggregating.
CREATE TABLE IF NOT EXISTS dlp_flags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject         TEXT NOT NULL UNIQUE,
    account         TEXT NOT NULL DEFAULT '',
    violation_count INT  NOT NULL DEFAULT 0,
    max_risk        FLOAT NOT NULL DEFAULT 0,
    last_site       TEXT NOT NULL DEFAULT '',
    last_reason     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'open',   -- open | acknowledged
    first_flagged   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_violation  TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_dlp_flags_status ON dlp_flags(status, last_violation);

INSERT INTO schema_migrations(version) VALUES(9) ON CONFLICT DO NOTHING;
