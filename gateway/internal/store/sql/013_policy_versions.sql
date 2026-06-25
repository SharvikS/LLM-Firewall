-- Migration 013: policy version history.
-- Policy history is retained even after a policy is deleted, so auditors can
-- reconstruct what changed and who changed it.

CREATE TABLE IF NOT EXISTS policy_versions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id     UUID NOT NULL,
    version       INTEGER NOT NULL,
    change_type   TEXT NOT NULL CHECK (change_type IN ('created','updated','deleted')),
    snapshot      JSONB NOT NULL,
    actor_email   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_versions_policy_version
    ON policy_versions(policy_id, version);

CREATE INDEX IF NOT EXISTS idx_policy_versions_policy_created
    ON policy_versions(policy_id, created_at DESC);

INSERT INTO schema_migrations(version) VALUES(13) ON CONFLICT DO NOTHING;
