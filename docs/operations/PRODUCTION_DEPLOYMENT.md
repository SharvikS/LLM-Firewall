# TITAN Production Deployment Guide

This guide is the enterprise deployment path for running TITAN as a governed AI
security control plane, not just a local demo.

## Deployment Targets

Use one of these patterns:

| Pattern | Use when | Command |
|---|---|---|
| Single-region Kubernetes | First production install or POC | `helm upgrade --install titan ./helm/titan -n titan --create-namespace -f values-prod.yaml` |
| Multi-region Kubernetes | Regulated workloads with data locality | Install one Helm release per region with `helm/titan/regions/*.yaml` |
| Local prod-like validation | Preflight before cluster install | `docker compose up -d --build` |

## Required Production Inputs

Create a Kubernetes Secret or external secret with:

| Key | Purpose |
|---|---|
| `admin-token` | Machine admin token for automation only |
| `auth-signing-secret` | Dashboard session signing secret |
| `provider-api-key` | Primary LLM provider key |
| `fallback-api-key` | Optional fallback provider key |
| `oidc-client-secret` | Optional OIDC client secret |

Set these gateway environment values:

| Variable | Production expectation |
|---|---|
| `APP_ENV` | `production` |
| `AUTH_SIGNING_SECRET` | Strong random secret, from secret manager |
| `DEFAULT_ADMIN_PASSWORD` | Strong bootstrap password or disabled after SSO |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_REDIRECT_URL` | Required for SSO |
| `OIDC_ADMIN_GROUPS` / `OIDC_SECURITY_GROUPS` / `OIDC_COMPLIANCE_GROUPS` | Map IdP groups to TITAN roles |
| `CLICKHOUSE_URL` | Required for analytics dashboards |
| `KAFKA_BROKERS` | Regional Redpanda/Kafka brokers |
| `DB_CONN_STRING` | CockroachDB regional endpoint with TLS |
| `ASR_URL` | Optional but required for live sandbox execution from the dashboard |
| `ASR_TIMEOUT_MS` | Sandbox execution request timeout; default `30000` |

## Preflight Checklist

1. Render Helm values in CI with the exact production values.
2. Confirm `APP_ENV=production` refuses default secrets.
3. Confirm SSO login and role mapping with a non-admin test user.
4. Send one benign, one prompt-injection, and one PII request through the gateway.
5. Verify `/admin/v1/audit` contains request and control-plane events.
6. Verify the SIEM collector receives `titan.siem.v1` events.
7. Run `scripts/redteam-eval.py --gateway https://<gateway> --api-key <tenant-key>`.
8. If ASR is enabled, launch one `run_bash` sandbox execution and confirm the
   result appears in `/admin/v1/sandboxes` and audit logs.
9. Export compliance coverage from `/admin/v1/compliance/coverage`.
10. Run a backup and restore drill using `docs/operations/DR_RUNBOOK.md`.

## Runtime SLOs

Track these before launch:

| Metric | Target |
|---|---|
| Gateway p95 overhead | Under 25 ms excluding provider latency |
| Gateway p99 overhead | Under 100 ms excluding provider latency |
| Audit persistence lag | Under 60 seconds |
| ML analyzer availability | 99.9% or documented fail-open policy |
| SIEM delivery lag | Under 10 seconds for high-risk events |

## Fail-Open / Fail-Closed Policy

Document this per customer:

| Component | Default |
|---|---|
| API key auth | Fail closed |
| Payload size guard | Fail closed |
| Cedar policy compile/eval | Fail closed |
| Redis rate limit/cache | Degrade/fail open |
| ML analyzer | Fail open on transport error |
| Output scanning | Fail open on transport error |
| ASR sandbox execution | Fail closed for unknown tools; dashboard reports unavailable without `ASR_URL` |
| Browser DLP strict mode | Operator configurable |
| SIEM webhook | Fail open; delivery errors logged |

## Operational Handoff

Before a customer launch, hand over:

- Helm values with secrets redacted.
- OIDC group-to-role mapping.
- SIEM collector format and endpoint owner.
- Backup schedule and restore-drill evidence.
- Red-team eval report.
- Compliance coverage report.
- Runbook links: `DEMO_RUNBOOK.md`, `DR_RUNBOOK.md`, `Runbook_OOM_Redpanda.md`.
