# TITAN Buyer Security Packet

Last updated: 2026-06-25

## Product Summary

TITAN Gateway is a zero-trust LLM security gateway that sits between enterprise
applications, browser users, and upstream LLM providers. It enforces tenant API
keys, rate limits, monthly quotas, prompt-injection controls, PII/secret
masking, output scanning, Cedar policy, SIEM alerting, SSO/RBAC, and audit
evidence.

## Architecture

Runtime components:

- Go gateway data plane and Admin API.
- Python ML engine for prompt-injection, toxicity, PII, file, and image
  scanning.
- Next.js dashboard control plane.
- Browser DLP extension for ChatGPT, Claude, Gemini, and Perplexity web UIs.
- CockroachDB for tenants, API keys, policies, users, settings, audit rows, and
  policy versions.
- Redis for rate limits, quotas, exact cache, and metrics buffers.
- Kafka/Redpanda and ClickHouse for audit/event analytics.
- Qdrant for semantic cache.
- Helm chart for Kubernetes deployment.

Primary trust boundaries and security assumptions are documented in
`docs/security/THREAT_MODEL.md`.

## Data Handling

TITAN does not need to persist raw prompts for enforcement. Data-plane audit
events use redacted prompt placeholders and record metadata such as tenant,
request ID, action, risk score, status code, latency, path, reason, region,
provider, and model.

PII and secrets detected in prompts are masked before the request reaches the
upstream LLM. Output scanning masks PII/secrets emitted by the model before the
response reaches the client where detectors succeed. Provider failover replays
the masked body.

Browser DLP telemetry is metadata-only. It reports site, event type, verdict,
risk, finding categories, and device/user labels where configured; it must not
send raw prompt, file, image, or PII content.

## Access Control

- Tenant API keys protect data-plane LLM requests.
- Dashboard sessions are signed and expire by configuration.
- Optional OIDC SSO validates provider-signed ID tokens through JWKS, issuer,
  audience, expiry, nonce, and verified email.
- RBAC roles: viewer, compliance, security, admin.
- Legacy `X-Admin-Token` remains for machine automation.
- Production startup rejects public default secrets when `APP_ENV=production`.

## Audit and SIEM

TITAN records both data-plane and control-plane events. Control-plane events
include actor ID/email/role/type, target type/ID, source IP, user agent, action,
status, and reason.

Kafka remains the preferred audit transport. The relational database write path
uses event IDs and idempotent inserts. Data-plane and Browser DLP audit events
now fall back to direct DB persistence when Kafka is unavailable or a produce
callback fails.

SIEM/webhook export uses the stable `titan.siem.v1` event contract with generic
JSON, Slack, Teams, Splunk HEC, Datadog, and Elastic/ECS envelopes.

## Control Mapping

| Control area | TITAN evidence |
|---|---|
| Identity and access | SSO/OIDC, signed sessions, RBAC, API keys |
| Data protection | PII/secret masking, output scanning, browser DLP |
| Governance | Cedar policy, guardrails, policy playground, version history |
| Monitoring | Events feed, audit logs, SIEM export, metrics, Grafana/ClickHouse |
| Incident response | Audit export, DLP flags, SIEM alerts, runbooks |
| Resilience | Rate limits, quotas, failover, readiness probes, backup/restore docs |
| Compliance support | OWASP/NIST coverage API, audit export, immutable policy snapshots |

## Deployment Checklist

Before production:

1. Deploy with Helm using customer-owned secrets or external secret manager.
2. Set `APP_ENV=production`.
3. Replace default admin password and machine admin token.
4. Configure OIDC and validate role mapping with non-admin users.
5. Configure SIEM collector and verify `titan.siem.v1` delivery.
6. Run `scripts/redteam-eval.py` against the deployed gateway.
7. Run the load/SLO matrix from `docs/security/LOAD_SLO_REPORT.md`.
8. Run backup and restore drill from `docs/operations/DR_RUNBOOK.md`.
9. Export compliance coverage from `/admin/v1/compliance/coverage`.
10. Archive CI results from `release-gates` and `security-scan`.

## Pentest Plan

Recommended scope:

- Data-plane auth bypass, tenant isolation, policy bypass, prompt-injection
  bypass, PII/secret exfiltration, streaming output leakage, failover leakage.
- Admin auth, OIDC callback handling, RBAC, CSRF/session handling, dashboard XSS.
- Browser extension telemetry integrity and content privacy.
- Kafka/DB/SIEM audit durability under component failure.
- Helm/Kubernetes hardening, secret handling, and network boundaries.

Recommended exclusions:

- Physical attacks on customer infrastructure.
- Third-party LLM provider internals.
- Denial-of-service beyond agreed test windows.

## Current Evidence Gaps

- No third-party pentest report is included in this repository.
- No SOC 2 / ISO 27001 certification is claimed.
- Fresh load/SLO results must be collected from a production-like environment.
- Python and Go vulnerability scans should be refreshed by CI before release.
