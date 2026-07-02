-- Migration 016: tenant-scoped control-plane access.
-- A user with zero rows remains global for backwards compatibility. A user with
-- one or more rows is scoped to exactly those tenants.

CREATE TABLE IF NOT EXISTS user_tenant_access (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tenant_access_tenant
    ON user_tenant_access(tenant_id, user_id);
