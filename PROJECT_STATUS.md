# LLM-Firewall (TITAN Gateway) — Project Status Log

> **Auto-maintained log.** Updated at the end of every major session or when significant changes are made.
> Last updated: 2026-06-07 (Session 5)

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

- [x] **5. Semantic Caching via Qdrant** — DONE. `cache/semantic.go` uses Qdrant REST API + ML engine embedding endpoint. `all-MiniLM-L6-v2` generates 384-dim vectors; cosine similarity ≥ 0.95 (configurable) triggers a hit. Docker Compose now includes Qdrant. Falls back gracefully if Qdrant/embedding unavailable.
- [x] **6. Token-Based Rate Limiting** — DONE. Added `AllowTokens()` TPM method to `ratelimit.go` (1-min tumbling Redis bucket). Proxy checks TPM in Stage 3 after RPM. Enable via `RATE_LIMIT_TPM=<n>` env var (0 = disabled). Returns `X-RateLimit-Tokens-Remaining` header.
- [x] **7. Toxicity / Sentiment Detection** — DONE. `ml_engine/analyzer/toxicity_detector.py`: two-layer (heuristic lexicon + optional `unitary/toxic-bert`) BLOCK gate wired after injection. Configurable via `TOXICITY_ENABLED` / `TOXICITY_BLOCK_THRESHOLD`.
- [x] **8. Source Code Leak Prevention** — DONE. `ml_engine/analyzer/secret_scanner.py`: masks hardcoded credentials (`<SECRET:LABEL>`) and detects large source-code pastes via a density heuristic. Composed into the same per-message masking pass as PII. `CODE_LEAK_BLOCK=true` blocks code pastes; default flags + raises risk.
- [x] **9. Multi-Provider Failover / Smart Routing** — DONE. Added `FallbackTargetURL` + `FallbackAPIKey` config (env vars). Proxy builds a second `httputil.ReverseProxy`; `ModifyResponse` triggers failover on 502/503/504; `ErrorHandler` replays request body (stored in context) to fallback. Logs a warning on failover.
- [ ] **10. OpenTelemetry (OTel) Observability** — No distributed tracing or metrics export. Required for multi-region visibility.

### Lower Priority

- [ ] **11. Integration Test Coverage** — Unit tests exist for cache, auth, policies, API keys, ML detector. Missing: E2E pipeline tests, multi-tenant isolation tests, Kafka producer tests, load/stress tests.
- [ ] **12. Multi-Region K8s Deployment** — K8s manifests exist but no Terraform/Helm charts, no cross-region replication, no automated failover.
- [ ] **13. Audit Log Query Performance** — Basic offset/limit pagination. No cursor-based pagination or index optimization.
- [ ] **14. Compliance Reporting** — No SOC2/HIPAA/GDPR report generation or audit trail export.
- [x] **15. OpenAPI/Swagger Docs** — DONE. Embedded OpenAPI 3.0 spec (`gateway/internal/api/openapi.json`) served at `/openapi.json` with Swagger UI at `/docs` (top-level, bypassing admin auth). Covers admin API, read API, proxy and batch.
- [x] **16. Client SDKs** — DONE. `sdk/python` (stdlib `TitanClient`) and `sdk/node` (ESM over fetch + `.d.ts`) wrap the full Admin API + read API.
- [ ] **17. gRPC Schema Versioning** — Proto file exists but no backward compatibility strategy.
- [x] **18. Batch Processing API** — DONE. `POST /v1/batch` (async, ≤100 items, ML governance per item) + `GET /v1/batch/{id}` (tenant-scoped). Redis-backed job state with in-memory fallback. `gateway/internal/batch/`.

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

**Remaining critical items:** #1 (Cedar), #2 (Firecracker), #3 (ClickHouse)

### 2026-06-06 — Phase 2 Production Readiness (Audit Fixes)
**Input:** Phase 2 code audit identifying 4 critical flaws: TPM starvation bug, in-memory metrics scaling barrier, brittle exact-match cache, missing Qdrant semantic cache.

**Changes made:**

| File | Change |
|---|---|
| `gateway/internal/ratelimit/ratelimit.go` | Fixed TPM Lua starvation: `GET` before `INCRBY` — rejected requests no longer consume quota |
| `gateway/internal/cache/cache.go` | Added `normalizeBody()`: JSON unmarshal→remarshal before hashing so key-order variants get the same cache key |
| `gateway/internal/cache/semantic.go` | NEW: `SemanticCache` using Qdrant REST API + embedding HTTP service. UUID v5 point IDs, base64 payload, 0.95 cosine threshold |
| `gateway/internal/metrics/reporter.go` | NEW: Redis reporter — 5s flush loop, counter INCRBY delta pipeline, latency RPUSH+LTRIM, traffic HINCRBY, `GlobalSnapshot()` with local fallback |
| `gateway/internal/metrics/collector.go` | Added non-blocking channel sends in `LatencyTracker.Record()` and `HourlyBucket.Record()` for reporter to drain |
| `gateway/internal/config/config.go` | Added `QdrantURL`, `EmbeddingURL`, `SemanticCacheThreshold`, `getEnvFloat64()` |
| `gateway/internal/proxy/proxy.go` | Added `semanticCache *cache.SemanticCache` field; updated `NewLLMProxy` signature; Stage 6 now checks exact→semantic; Stage 7 stores in both; extracted `serveCachedEntry()` helper |
| `gateway/cmd/server/main.go` | Added `metrics.Init(redisClient)`, `SemanticCache` creation, updated `NewLLMProxy` call, `metricsHandler` now uses `metrics.GlobalSnapshot()` |
| `ml_engine/requirements.txt` | Added `sentence-transformers>=2.7.0` |
| `ml_engine/analyzer/embed.py` | NEW: stdlib HTTP embedding server (daemon thread), loads `all-MiniLM-L6-v2`, exposes `POST /embed` |
| `ml_engine/analyzer/server.py` | Calls `embed.start()` at startup alongside gRPC |
| `docker-compose.yml` | Added Qdrant service + `qdrant_data` volume; added `EMBED_PORT:8001` to ml_engine; added `QDRANT_URL`, `EMBEDDING_URL`, `SEMANTIC_CACHE_THRESHOLD` to gateway |

**Items completed:** #4 (Metrics persistence → Redis reporter), #5 (Qdrant semantic cache), TPM starvation bug, JSON normalization bug

**Remaining critical items:** #1 (Cedar policy engine), #2 (Firecracker sandbox), #3 (ClickHouse analytics)

**Next suggested action:** Item #3 (ClickHouse) — add audit log write path from Kafka consumer to ClickHouse, and a read path for the dashboard's analytics queries. Kafka consumer already exists in Redpanda; ClickHouse has a native Kafka table engine.

### 2026-06-07 — Phase 3 Deep Reliability & Security Fixes
**Input:** Phase 3 audit — connection pool exhaustion DoS, admin timing attack, audit N+1, siloed event feed.

**Changes made:**

| File | Change |
|---|---|
| `gateway/internal/store/store.go` | Added `keyTouchQueue chan uuid.UUID` field + `uuid` import; initialised queue (buf=2048); started `keyTouchWriter` goroutine; close queue in `Close()` |
| `gateway/internal/store/api_keys.go` | `TouchAPIKey` now non-blocking channel send (no more unbounded goroutines). Added `keyTouchWriter`: 5s ticker, dedup map, single bulk `UPDATE ... FROM unnest(ids, counts)` per flush |
| `gateway/internal/api/admin.go` | Replaced `provided != token` with `subtle.ConstantTimeCompare` — fixes timing attack on master admin token |
| `gateway/internal/store/audit.go` | Replaced N×1 `tx.Exec` loop with `pgx.Batch` + `SendBatch` — all 50 INSERTs pipelined into one TCP round-trip. Removed explicit transaction. |
| `gateway/internal/metrics/collector.go` | `EventRingBuffer.Push()` now does a non-blocking send to `eventQueue` channel after local write |
| `gateway/internal/metrics/reporter.go` | Added `eventQueue chan Event`; drain in `flushAll` via LPUSH+LTRIM; added `GlobalEvents(ctx, n)` reading from Redis `gateway:events` list with local fallback |
| `gateway/cmd/server/main.go` | `eventsHandler` now calls `metrics.GlobalEvents()` — dashboard shows cluster-wide events, not just one replica's view |

**What was fixed and why it matters:**
- **Connection pool DoS**: 20 concurrent requests no longer spawn 20 DB goroutines. Pool never exhausted.
- **Timing attack**: Admin token comparison is now constant-time regardless of character position.
- **Audit N+1**: 50 INSERT queries → 1 pipelined batch = ~50× fewer DB round-trips per flush.
- **Siloed events**: All gateway replicas now write to `gateway:events` Redis list; dashboard sees cluster-wide threat feed.

**Remaining critical items:** #1 (Cedar policy engine), #2 (Firecracker sandbox), #3 (ClickHouse analytics)
**Known gap (not fixed):** Audit queue silent drop under sustained DB slowdown — `EnqueueAudit` drops rows when queue hits 4096 capacity. Log warning is emitted but for strict SOC2 compliance a dead-letter channel or back-pressure mechanism is needed.

### 2026-06-07 — Phase 4 "Pitch Perfect" Edge Cases
**Input:** Phase 4 audit — OOM crash, cache poisoning, plaintext gRPC, missing DB indexes, timeline algorithm corruption.

**Changes made:**

| File | Change |
|---|---|
| `gateway/internal/proxy/proxy.go` | `responseCapture` now has `overflowed bool`; `Write()` discards buffer and sets flag if response exceeds 5 MB; Stage 7 only caches when `!rc.overflowed && r.Context().Err() == nil` (OOM guard + disconnect guard) |
| `gateway/internal/config/config.go` | Added `AnalyzerTLSEnabled bool`, `AnalyzerTLSCertFile string`; added `getEnvBool()` helper |
| `gateway/internal/analyzer/client.go` | `New()` now accepts `tlsEnabled bool, certFile string`; uses `credentials.NewClientTLSFromFile()` when TLS enabled, `insecure.NewCredentials()` otherwise; logs warning when plaintext |
| `gateway/cmd/server/main.go` | Updated `analyzer.New()` call to pass TLS config |
| `ml_engine/analyzer/server.py` | `serve()` reads `GRPC_TLS_ENABLED` env; uses `grpc.ssl_server_credentials()` when true, falls back to plaintext with error log on cert load failure |
| `gateway/internal/store/sql/001_schema.sql` | Added `idx_api_keys_tenant_created ON api_keys(tenant_id, created_at DESC)` and `idx_policies_tenant_enabled ON policies(tenant_id, enabled, created_at DESC)` |
| `gateway/internal/metrics/collector.go` | `HourlyBucket.lastHour int` → `lastTick time.Time`; `Record()` computes true elapsed hours via `nowHour.Sub(hb.lastTick)/time.Hour`; loops to zero all skipped slots — gaps longer than 1 hour no longer corrupt the chart |

**What was fixed and why it matters:**
- **OOM**: A 100 MB LLM response no longer crashes the pod — forwarded to client, never buffered past 5 MB.
- **Cache poisoning**: Client disconnect mid-response sets `context.Err() != nil` — the partial buffer is never written to Redis or Qdrant.
- **gRPC PII leak**: All prompt text (including unmasked PII before Presidio runs) can now be encrypted in transit. Enable with `ANALYZER_TLS_ENABLED=true` + cert mount.
- **Table scans**: `ListAPIKeys` and `ListPolicies` now hit covering indexes instead of full scans.
- **Timeline corruption**: 3 hours of silence then 1 request no longer shows a spike 3 hours in the past — all skipped slots are explicitly zeroed.

**Remaining items:** #1 (Cedar), #2 (Firecracker), #3 (ClickHouse)
**To enable gRPC TLS in production:** Mount a cert/key pair into the ml_engine pod at `/etc/certs/tls.crt` + `/etc/certs/tls.key`, set `GRPC_TLS_ENABLED=true` on the ml_engine service, and `ANALYZER_TLS_ENABLED=true` + `ANALYZER_TLS_CERT_FILE=/etc/certs/tls.crt` on the gateway.

### 2026-06-10 — Feature Completion Session
**Input:** "Finish this project" → scoped to *feature completion* — build the unbuilt features named in the README/status (toxicity, source-code-leak prevention, OpenAPI docs, client SDKs, batch API).

**Changes made:**

| File | Change |
|---|---|
| `ml_engine/analyzer/toxicity_detector.py` | NEW: two-layer toxicity detector (heuristic lexicon + optional `unitary/toxic-bert`); BLOCK gate. |
| `ml_engine/analyzer/secret_scanner.py` | NEW: credential masking (`<SECRET:LABEL>`) + source-code-leak density heuristic. |
| `ml_engine/analyzer/server.py` | Wired toxicity BLOCK gate after injection; restructured the masking pass to compose PII + secrets into one rewrite; added code-leak flag/BLOCK + `SourceCodeLeak`/`SecretLeak`/`Toxicity` threat details. |
| `gateway/internal/api/openapi.{json,go}` | NEW: embedded OpenAPI 3.0 spec + Swagger UI, served at `/openapi.json` and `/docs`. |
| `gateway/internal/batch/batch.go` | NEW: async batch manager — Redis-backed (in-memory fallback), ML governance per item, upstream forwarding. |
| `gateway/internal/api/batch.go` + `batch_test.go` | NEW: `/v1/batch` submit/status handlers (tenant-scoped) + integration tests (routing precedence, governance, cross-tenant 404). |
| `gateway/cmd/server/main.go` | Mounted OpenAPI/docs at top level; created batch manager; registered `/v1/batch` routes before the proxy wildcard. |
| `sdk/python/`, `sdk/node/` | NEW: dependency-free Python + Node SDKs wrapping the Admin + read API. |
| `.env.example` | Documented `TOXICITY_*` and `CODE_LEAK_*` knobs. |

**Items completed:** #7 (Toxicity), #8 (Source-code leak), #15 (OpenAPI/Swagger), #16 (Client SDKs), #18 (Batch API)

**Verification:** `go build ./...` + `go test ./...` green (new batch tests pass); Python modules `py_compile` + import clean; both SDKs instantiate; `openapi.json` validates.

**Remaining items:** #1 (Cedar), #2 (Firecracker), #3 (ClickHouse), #10 (OTel), #17 (gRPC versioning), plus test/infra items.

---

## How to Continue

1. Read this file at the start of each session for full context.
2. Pick a pending item from the list above.
3. When work is done, mark the item `[x]` and add a new entry to the **Session Log** section above.

