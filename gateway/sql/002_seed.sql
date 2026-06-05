-- Seed data for local development.
-- Dev API key: titan_dev_localkeyfortesting1234
-- SHA-256:     printf 'titan_dev_localkeyfortesting1234' | sha256sum  →  stored in key_hash below
-- The gateway .env sets GROQ_API_KEY; for dev auth use the raw key above as the Bearer token.

INSERT INTO tenants (id, name, tier, rate_limit)
VALUES ('00000000-0000-0000-0000-000000000001', 'dev', 'enterprise', 1000)
ON CONFLICT (name) DO NOTHING;

-- titan_dev_localkeyfortesting1234
-- echo -n 'titan_dev_localkeyfortesting1234' | sha256sum
INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Local Dev Key',
    '423dc836d6e0dd409ff96c02e6833a4eb83e61de5730a243520255aa9a56dd55',
    'titan_de'
)
ON CONFLICT (key_hash) DO NOTHING;

-- Seed default global policies
INSERT INTO policies (tenant_id, name, description, effect, principal, action, condition, enabled)
VALUES
    (NULL, 'Block High-Risk Requests',
     'Deny any request where ML risk_score exceeds 70.',
     'DENY', '*', 'InvokeLLM', 'risk_score > 70', true),
    (NULL, 'GDPR EU Strict Mode',
     'Enforce strict PII redaction for EU-origin requests.',
     'ALLOW', 'eu_tenants', 'InvokeLLM', 'region == "EU"', true),
    (NULL, 'GPT-4 Admin Only',
     'Restrict GPT-4o access to admin-role principals.',
     'DENY', '!admin', 'InvokeLLM', 'model == "gpt-4o"', true)
ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING;

INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT (version) DO NOTHING;
