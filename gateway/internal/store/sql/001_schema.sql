-- Titan LLM Firewall — initial schema
-- Idempotent: safe to re-run (all CREATE TABLE IF NOT EXISTS)

-- ── Tenants ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT        NOT NULL UNIQUE,
    tier          TEXT        NOT NULL DEFAULT 'standard'   CHECK (tier IN ('standard','enterprise')),
    rate_limit    INTEGER     NOT NULL DEFAULT 60,          -- requests per minute
    active        BOOLEAN     NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── API Keys ─────────────────────────────────────────────────────────────────
-- Raw keys never stored; only the SHA-256 hex digest is persisted.
-- key_prefix stores the first 8 chars of the raw key for display.
CREATE TABLE IF NOT EXISTS api_keys (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT        NOT NULL,
    key_hash      TEXT        NOT NULL UNIQUE,
    key_prefix    TEXT        NOT NULL,
    active        BOOLEAN     NOT NULL DEFAULT true,
    requests      BIGINT      NOT NULL DEFAULT 0,
    last_used_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Policies ─────────────────────────────────────────────────────────────────
-- tenant_id NULL = global policy applied to all tenants.
CREATE TABLE IF NOT EXISTS policies (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT        NOT NULL,
    description   TEXT,
    effect        TEXT        NOT NULL CHECK (effect IN ('ALLOW','DENY')),
    principal     TEXT        NOT NULL DEFAULT '*',
    action        TEXT        NOT NULL DEFAULT '*',
    condition     TEXT,
    enabled       BOOLEAN     NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Audit Events ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_events (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id    TEXT        NOT NULL,
    tenant_id     UUID        REFERENCES tenants(id) ON DELETE SET NULL,
    api_key_id    UUID        REFERENCES api_keys(id) ON DELETE SET NULL,
    action        TEXT        NOT NULL,
    risk_score    REAL,
    path          TEXT,
    latency_ms    INTEGER,
    status_code   INTEGER,
    reason        TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS policies ADD CONSTRAINT IF NOT EXISTS policies_name_tenant_uniq UNIQUE (name, tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS policies_global_name_uniq ON policies(name) WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_created  ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant   ON audit_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON audit_events(action, created_at DESC);

-- Covering index for ListAPIKeys(tenant_id ORDER BY created_at DESC).
-- Without this the query degrades to a full table scan as the key count grows.
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_created ON api_keys(tenant_id, created_at DESC);

-- Covering index for ListPolicies(tenant_id, enabled ORDER BY created_at DESC).
CREATE INDEX IF NOT EXISTS idx_policies_tenant_enabled ON policies(tenant_id, enabled, created_at DESC);

-- ── Schema version tracker ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
