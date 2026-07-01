# TITAN Editions

TITAN ships **open-core**. The core is free and MIT-licensed; a set of org-scale
features is commercially licensed as **TITAN Enterprise**. This file is the
canonical source of truth for what lives where.

| | **Community** | **Enterprise** |
|---|---|---|
| **License** | [MIT](LICENSE) | [Commercial](LICENSE-ENTERPRISE.md) |
| **Price** | Free, self-hosted | Paid (per-seat / subscription) |
| **Build** | `go build ./...` (default) | `go build -tags enterprise ./...` + license key |

## What's in the open-source core (MIT)

The complete zero-trust security engine — everything one developer or team needs
to protect their own LLM traffic:

- Drop-in OpenAI-compatible reverse proxy, live-switchable upstream, failover, SSE streaming
- Prompt injection & jailbreak detection (regex + DeBERTa)
- PII masking (Microsoft Presidio) — all entity types
- Toxicity detection, secret & source-code leak prevention
- Response-side output scanning (incl. inline streaming masking)
- Exact + semantic caching (Qdrant), single-tenant rate limiting
- No-code regex guardrails, default-deny policy engine
- Browser DLP extension — **text** scanning + redact-and-send
- Plan catalog, OpenAPI/Swagger, Python & Node SDKs, batch API
- Docker-compose stack, basic Kubernetes manifests, core dashboard

## What's TITAN Enterprise (commercial)

Features that matter once you're an organization — multiple teams, identity
systems, compliance auditors, and a SOC:

| Feature | Code locus | Gate |
|---|---|---|
| Per-tenant usage metering, plan quotas & billing enforcement | `gateway/internal/billing/meter_enterprise.go` | `edition.Billing` |
| Real-time SOC alerting (Slack/Teams/SIEM/PagerDuty/Splunk) | `gateway/internal/alerts/dispatcher_enterprise.go` | `edition.Alerts` |
| WASM custom-rule plugin stage (wazero sandbox) | `gateway/internal/plugins/runtime_enterprise.go` | `edition.Plugins` |
| OIDC single sign-on | `gateway/internal/auth/oidc.go` | `edition.SSO` |
| Compliance reporting & audit export | `gateway/internal/api/compliance.go` | `edition.Compliance` |
| Hallucination / groundedness scoring | `gateway/internal/proxy/groundedness.go`, `ml_engine/analyzer/hallucination_detector.py` | `edition.Groundedness` |
| Dashboard: Billing, Team, Access Control surfaces | `dashboard/src/app/page.tsx` | `me.features` |

> Multi-tenant **isolation** stays in the core (a single default tenant works
> for free). Only the multi-admin / SSO **management** surfaces are commercial.

## How the split is enforced

Two independent layers — neither alone can switch a paid feature on:

1. **Build tag.** The commercial *logic* only compiles under `-tags enterprise`.
   A default `go build` produces a binary that does not contain it; community
   no-op stubs (`*_community.go`) are linked instead. This also keeps heavy deps
   (e.g. wazero) out of the open-core build. Every commercial file is tagged
   `//go:build enterprise` and carries a `TITAN Enterprise — commercial license`
   header.
2. **Runtime license gate.** Even an enterprise build only activates a feature
   when `TITAN_EDITION=enterprise` **and** `TITAN_LICENSE_KEY` is set. See
   `gateway/internal/edition`.

```
go build ./...                  # Community (MIT) — default
go build -tags enterprise ./... # Enterprise — requires a license at runtime
```

Python: `hallucination_detector.py` is imported only when
`TITAN_EDITION=enterprise`; the open-core checkout can omit the file entirely and
groundedness scoring cleanly fails open.

## Pricing tiers

| Tier | Price | Audience | Includes |
|---|---:|---|---|
| **Free** | $0/mo | Individuals, single teams | Open-core, MIT, self-host, 10k inspected requests/month |
| **Starter** | $9.99/mo | Builders validating real traffic | Free + guided setup, usage visibility, 100k inspected requests/month |
| **Pro** | $35/mo | Growing orgs | Starter + multi-tenant metering, RBAC/audit/SOC surfaces, 1M inspected requests/month |

For commercial licensing: **sharviksutar@gmail.com**.
