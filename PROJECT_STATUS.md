# LLM-Firewall (TITAN Gateway) — Project Status Log

> **Auto-maintained log.** Updated at the end of every major session or when significant changes are made.
> Last updated: 2026-06-06 (Session 2)

---

## What This Project Is

**LLM-Firewall** (internal name: TITAN Gateway) is an enterprise zero-trust security gateway — a drop-in reverse proxy that sits between applications and LLM providers (OpenAI, Anthropic, Groq) to inspect, govern, secure, and route all LLM traffic. Think "Cloudflare for Generative AI."

**Stack:** Go (data plane) · Python/FastAPI (ML engine) · Next.js (dashboard) · PostgreSQL/CockroachDB · Redis · Kafka/Redpanda · Docker/Kubernetes

---

## Architecture Phase Status

| Phase | Description | Status |
|---|---|---|
| 1 | Go Gateway Foundation (proxy, auth, rate limit, cache) | Done |
| 2 | Enterprise Architecture & Design | Done |
| 3 | Documentation & UI Mockups | Done |
| 4 | Python ML Analyzer (injection + PII detection) | Done |
| 5 | Kafka Audit Logging & Postgres Integration | Done |
| 6 | Next.js Dashboard (full CRUD UI) | Done |
| 7 | Titan V2 — Cedar, Firecracker, CockroachDB migration | In Progress / Partially started |
| 8 | Multi-Region Active-Active Deployment | Not started |
| 9 | OpenTelemetry Observability | Not started |
| 10 | ClickHouse Analytics Layer | Not started |

---

## Fully Implemented Components

| Component | Location | Notes |
|---|---|---|
| Go API Gateway | `/gateway` | Reverse proxy, auth, rate limiting (RPM + TPM), provider failover, semantic cache (SHA-256), gRPC client, admin API |
| Python ML Analyzer | `/ml_engine/analyzer` | Regex + HuggingFace transformer (TF-IDF fallback) injection detection, Presidio PII masking, gRPC server |
| PostgreSQL Store | `/gateway/internal/store` | Tenants, API keys, policies, audit events, migrations |
| Next.js Dashboard | `/dashboard` | API Keys, Policies, Audit Logs, Metrics, Settings, Command Palette |
| Docker Compose | `/docker-compose.yml` | Full stack: Redis, CockroachDB, Redpanda, ML Engine, Gateway, Dashboard |
| Local Dev Script | `/start_local.sh` | Orchestrates venv, ML engine, gateway, dashboard |
| Kafka Audit Streaming | `/gateway/internal/kafka` | Async event producer, 500ms batch flush |
| K8s Manifests | `/k8s/` | gateway-deployment.yaml, asr-deployment.yaml, istio-gateway.yaml (manual only) |

---

## Pending Items

### Critical (Blocks Enterprise Readiness)

- [ ] **1. Cedar Policy Engine** — `gateway/internal/policy/cedar.go:12` has `TODO(phase-3)` stub. Not bound to real cedar-policy. Current fallback is a simple DB condition evaluator. Needs Cedar CGo binding or sidecar.
- [ ] **2. Firecracker MicroVM Sandbox** — `analyzer/core/sandbox.py` uses Docker containers instead of true Firecracker microVMs. Real security gap — containers can be escaped.
- [ ] **3. ClickHouse Analytics DB** — No OLAP layer. Audit logs in PostgreSQL won't scale to enterprise traffic. Required for real-time dashboard analytics.
- [ ] **4. Metrics Persistence** — `gateway/internal/metrics/collector.go` is in-memory only. All metrics reset on gateway restart. No historical trend data.

### Medium Priority

- [ ] **5. Semantic Caching via Qdrant** — Current caching is exact-match SHA-256 only. Semantically similar prompts always miss the cache. Needs embedding model + vector DB.
- [x] **6. Token-Based Rate Limiting** — DONE. Added `AllowTokens()` TPM method to `ratelimit.go` (1-min tumbling Redis bucket). Proxy checks TPM in Stage 3 after RPM. Enable via `RATE_LIMIT_TPM=<n>` env var (0 = disabled). Returns `X-RateLimit-Tokens-Remaining` header.
- [ ] **7. Toxicity / Sentiment Detection** — Mentioned in README, not implemented. Only injection and PII detection exist.
- [ ] **8. Source Code Leak Prevention** — Mentioned in README, not implemented.
- [x] **9. Multi-Provider Failover / Smart Routing** — DONE. Added `FallbackTargetURL` + `FallbackAPIKey` config (env vars). Proxy builds a second `httputil.ReverseProxy`; `ModifyResponse` triggers failover on 502/503/504; `ErrorHandler` replays request body (stored in context) to fallback. Logs a warning on failover.
- [ ] **10. OpenTelemetry (OTel) Observability** — No distributed tracing or metrics export. Required for multi-region visibility.

### Lower Priority

- [ ] **11. Integration Test Coverage** — Unit tests exist for cache, auth, policies, API keys, ML detector. Missing: E2E pipeline tests, multi-tenant isolation tests, Kafka producer tests, load/stress tests.
- [ ] **12. Multi-Region K8s Deployment** — K8s manifests exist but no Terraform/Helm charts, no cross-region replication, no automated failover.
- [ ] **13. Audit Log Query Performance** — Basic offset/limit pagination. No cursor-based pagination or index optimization.
- [ ] **14. Compliance Reporting** — No SOC2/HIPAA/GDPR report generation or audit trail export.
- [ ] **15. OpenAPI/Swagger Docs** — No API schema for the admin API.
- [ ] **16. Client SDKs** — No Python/Node.js/Go libraries for programmatic management.
- [ ] **17. gRPC Schema Versioning** — Proto file exists but no backward compatibility strategy.
- [ ] **18. Batch Processing API** — No `/v1/batch` endpoint for async bulk prompt jobs.

---

## Session Log

### 2026-06-06 — Initial Analysis Session
- Performed full project analysis across all directories.
- Identified 18 pending items across 4 priority tiers.
- Created this PROJECT_STATUS.md file.
- No code changes made this session.

### 2026-06-06 — Code Audit Fixes Session
**Input:** Full code audit identifying 4 bugs/gaps: fake ML model, hardcoded upstream URL, JSON fallback bug in `_rebuild_body`, RPM-only rate limiting.

**Changes made:**

| File | Change |
|---|---|
| `ml_engine/requirements.txt` | Added `transformers`, `torch`, `huggingface-hub`, `sentencepiece` |
| `ml_engine/analyzer/injection_detector.py` | Upgraded Layer 2 to HuggingFace `protectai/deberta-v3-base-injection` transformer; TF-IDF+LR kept as startup fallback if model unavailable |
| `ml_engine/analyzer/server.py` | Fixed `_rebuild_body` bug: non-JSON body now wrapped in `{"messages":[{"role":"user","content":...}]}` instead of returning raw string |
| `gateway/internal/config/config.go` | Added `FallbackTargetURL`, `FallbackAPIKey`, `RateLimitTPM` fields (env: `FALLBACK_TARGET_URL`, `FALLBACK_API_KEY`, `RATE_LIMIT_TPM`) |
| `gateway/internal/ratelimit/ratelimit.go` | Added `tpmLimit` field; new `AllowTokens()` method with atomic Redis Lua TPM tumbling-window script |
| `gateway/cmd/server/main.go` | Updated `ratelimit.New()` call to pass `cfg.RateLimitTPM` as 4th arg |
| `gateway/internal/proxy/proxy.go` | Added: `reqBodyKey` context type, `errUpstreamUnavailable`, `fallbackRP` field, failover proxy construction in `NewLLMProxy`, body stored in context, TPM check in Stage 3, `estimateTokens()` helper |

**Items completed:** #6 (TPM rate limiting), #9 (Provider failover), ML model gap (audit finding), JSON fallback bug (audit finding)

**Remaining critical items:** #1 (Cedar), #2 (Firecracker), #3 (ClickHouse), #4 (Metrics persistence)

**Next suggested action:** Item #4 (Metrics Persistence) — add Redis-backed persistence for counters so dashboard data survives gateway restarts. Scope is well-defined and self-contained.

---

## How to Continue

1. Read this file at the start of each session for full context.
2. Pick a pending item from the list above.
3. When work is done, mark the item `[x]` and add a new entry to the **Session Log** section above.

