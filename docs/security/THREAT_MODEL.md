# TITAN Gateway Threat Model

## Overview

TITAN Gateway is a multi-component security control plane for governing LLM
traffic. The primary runtime surfaces are the Go gateway (`gateway/`), Python ML
engine (`ml_engine/`), Next.js dashboard (`dashboard/`), Browser DLP extension
(`browser-extension/`), Kafka/ClickHouse audit pipeline, CockroachDB store,
Redis counters/cache, Qdrant semantic cache, Helm deployment assets, and
operator scripts.

The product sits between customer applications, human browser users, and
third-party or local LLM providers. Its most important assets are tenant API
keys, admin sessions, OIDC identities, policy state, runtime settings, audit
evidence, SIEM delivery, masked prompts/responses, provider API keys, and
customer prompts before they leave the enterprise boundary.

## Threat Model, Trust Boundaries, and Assumptions

Primary trust boundaries:

- Client application to gateway data plane: bearer API keys identify tenant and
  key scope; tenant identity must come from validated keys, never caller-supplied
  headers.
- Browser extension to gateway telemetry: browser reports are unauthenticated
  unless `BROWSER_EVENT_TOKEN` is configured; events must never contain raw
  prompt, PII, or file content.
- Dashboard user to Admin API: session auth, OIDC SSO, and RBAC protect
  control-plane mutation surfaces.
- Gateway to ML engine: analyzer failures are usually fail-open by design, while
  payload-size, auth, policy, and request parsing failures are fail-closed.
- Gateway to Kafka/DB/SIEM: audit delivery must preserve evidence under broker
  failure, duplicate delivery, and process shutdown.
- Gateway to upstream LLM providers: only masked request bodies and provider
  credentials should cross this boundary.
- Operator to deployment secrets: Helm/Kubernetes secrets, `.env` files, and
  provider keys are operator-controlled and must not be exposed to users or logs.

Attacker-controlled inputs include LLM request bodies, model names, paths under
proxied routes, prompt text, streaming upstream responses, browser DLP event
metadata, uploaded file contents scanned by the ML engine, API key values,
dashboard form fields, policy conditions, and OIDC callback parameters.

Operator-controlled inputs include gateway settings, policies, guardrails,
tenant plans, upstream URLs, OIDC configuration, SIEM endpoints, Helm values,
and feature license/edition controls.

Developer-controlled inputs include CI workflows, lockfiles, migrations, test
fixtures, demo scripts, and documentation. These are not runtime attacker input,
but they affect supply-chain and release integrity.

Key invariants:

- A request without a valid tenant API key must not reach an upstream LLM.
- Tenant identity must be derived from authenticated data, not untrusted request
  metadata.
- PII/secrets detected before proxying must be masked before provider failover
  or retry.
- A policy `DENY` must win over `ALLOW`; no implicit allow fallthrough.
- Admin mutation routes must enforce RBAC and create control-plane audit records.
- Audit records must be idempotent and retained even when Kafka redelivers.
- Browser DLP telemetry must omit raw user content.
- Enterprise-only code paths must require both enterprise build tags and runtime
  license/edition activation.

## Attack Surface, Mitigations, and Attacker Stories

Data-plane attacks:

- Prompt-injection, jailbreak, and policy-bypass content is inspected by regex,
  ML analysis, Cedar policy, custom guardrails, and WASM plugins.
- PII, secrets, and output-side leakage are masked before leaving the trust
  boundary where detectors succeed.
- Oversized request bodies are capped before full memory ingestion.
- Rate limits and monthly quotas reduce cost-exhaustion blast radius.
- Provider failover reuses the masked body, not the original raw request.

Control-plane attacks:

- Dashboard auth uses signed sessions and optional OIDC SSO with JWKS, issuer,
  audience, nonce, expiry, and email verification checks.
- Admin routes enforce role tiers: viewer, compliance, security, and admin.
- Settings, policies, keys, users, billing, and DLP acknowledgements write
  control-plane audit metadata.
- Policy version history preserves policy state across edits/deletes.

Audit and observability attacks:

- Kafka consumer inserts use event IDs and `ON CONFLICT DO NOTHING` for
  idempotent at-least-once delivery.
- Data-plane and Browser DLP events now use a direct database fallback when the
  Kafka producer is unavailable or produce callbacks fail.
- SIEM export uses a stable `titan.siem.v1` envelope and logs delivery failure
  without blocking the data plane.

Supply-chain and deployment attacks:

- GitHub Actions run dependency scans, Go tests, enterprise-tag tests,
  dashboard lint/typecheck/build, ML pytest, Browser DLP package checks, and
  Helm chart rendering.
- Production startup refuses default public secrets when `APP_ENV=production`.
- Helm deployment expects secrets from Kubernetes or an external secret manager.

Realistic attacker stories:

- A compromised application key sends prompt-injection traffic. Expected outcome:
  tenant-scoped rate limits apply, high-risk prompts are blocked, and audit/SIEM
  records are generated.
- A malicious internal user with viewer access attempts to change policies.
  Expected outcome: RBAC denies mutation and control-plane auth/audit records
  preserve evidence.
- Kafka is unavailable during a burst of blocked requests. Expected outcome:
  the gateway persists audit events directly to the relational store with the
  same event IDs used for idempotent inserts.
- A browser user pastes secrets into ChatGPT web UI. Expected outcome: the
  extension blocks/redacts before send and reports metadata-only telemetry.

Out of scope or lower-confidence areas:

- This repository does not itself certify SOC 2, ISO 27001, or a third-party
  pentest result.
- The ML detector corpus is an internal regression baseline, not an independent
  benchmark.
- Customer-specific IdP, SIEM, retention, residency, and fail-open/fail-closed
  choices must be validated per deployment.

## Severity Calibration

Critical:

- Valid tenant API key bypass that lets unauthenticated traffic reach an LLM.
- Cross-tenant data exposure in audit, billing, policies, settings, or API keys.
- Raw prompt/PII/secret persistence in durable audit stores contrary to product
  guarantees.
- Admin auth bypass or privilege escalation to security/admin role.

High:

- Policy-engine bug that converts explicit `DENY` into allow.
- Provider failover or retry path that sends unmasked raw bodies upstream.
- Kafka/audit failure mode that silently drops blocked/security-relevant events
  without DB fallback or operator-visible error.
- OIDC validation bug accepting wrong issuer/audience/signature.

Medium:

- Detector false negatives for known prompt-injection patterns where policy or
  guardrails could compensate.
- SIEM delivery failure that is logged but not surfaced in dashboard health.
- Browser telemetry spoofing when `BROWSER_EVENT_TOKEN` is unset on an internet
  exposed deployment.
- Dashboard XSS limited to an authenticated user without admin privilege.

Low:

- Demo/local-only defaults when production guardrails reject them under
  `APP_ENV=production`.
- Analytics/card display bugs that do not affect enforcement or audit evidence.
- Documentation drift in historical planning files clearly marked as historical.
