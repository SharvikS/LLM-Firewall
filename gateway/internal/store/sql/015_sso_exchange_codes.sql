-- Migration 015: one-time SSO exchange codes.
-- The browser only sees this short-lived code; the dashboard backend redeems it
-- for a session JWT over a server-to-server call authenticated by ADMIN_TOKEN.

CREATE TABLE IF NOT EXISTS sso_exchange_codes (
    code_hash   TEXT        PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email       TEXT        NOT NULL,
    role        TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sso_exchange_codes_expiry
    ON sso_exchange_codes(expires_at);
