-- Migration 007: control-plane users for dashboard auth + RBAC.
-- Local users carry a bcrypt password_hash; OIDC users have an empty hash and
-- auth_provider='oidc'. The default admin is bootstrapped in Go at startup (the
-- bcrypt hash can't be precomputed in static SQL).

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'viewer',
    auth_provider TEXT NOT NULL DEFAULT 'local',
    disabled      BOOL NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

INSERT INTO schema_migrations(version) VALUES(7) ON CONFLICT DO NOTHING;
