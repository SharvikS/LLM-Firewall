-- API-key scoped request sandbox profiles. These let one firewall key enforce
-- its own constrained model/path/rate boundary independent of the tenant.
ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS sandbox JSONB NOT NULL DEFAULT '{"enabled":false,"allowed_paths":["/v1/chat/completions","/v1/completions","/v1/embeddings"]}'::jsonb;

INSERT INTO schema_migrations(version) VALUES(14) ON CONFLICT DO NOTHING;
