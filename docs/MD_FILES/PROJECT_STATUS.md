# LLM-Firewall (TITAN Gateway) — Project Status Log

> **Auto-maintained log.** Updated at the end of every major session or when significant changes are made.
> Last updated: 2026-06-14 (Enterprise-Readiness / Sellability Session)

---

## 2026-06-14 — Enterprise-Readiness Session (the 5 "can't sell without" blockers)

Closed the five hard blockers between "great demo" and "sellable to an
enterprise security buyer". All committed; gateway build + full Go suite green.

**1. Dashboard auth + RBAC** (committed prior in this session set)
- First-party login (bcrypt + dependency-free HS256 JWT sessions), 4-tier role
  model (viewer/compliance/security/admin) enforced *in the gateway* per route,
  machine master-token path preserved, config-gated OIDC SSO. Team + user mgmt
  are live; default admin bootstrapped on first boot.

**2. Per-tenant configuration**
- Settings are now layered: a `global` document with sparse per-tenant override
  patches (keyed by tenant UUID). Proxy enforces per-tenant RPM/TPM and reads
  per-tenant effective settings each request. `?tenant=<uuid>` on the settings
  API + a dashboard scope selector; revert-to-global supported.

**3. Detection-efficacy benchmark** (`ml_engine/eval/`)
- Reproducible harness over a 60-sample **held-out** corpus (asserts zero
  train/eval overlap). Also fixed Layer 2 being disabled in practice (corpus was
  under the 100-sample threshold) by expanding the generator to 228 balanced
  samples → TF-IDF Layer 2 now actually trains.
- **Production (deberta-v3 transformer): precision 96.2%, recall 83.3%, F1 89.3%,
  FPR 3.3%, 75% recall on regex-evading paraphrased attacks.** Offline TF-IDF
  fallback: 94.7% / 60.0% / 3.3% / 25%. Corpus is synthetic/in-house — an
  internal regression baseline, not a third-party claim. See `eval/REPORT.md`.

**4. Streaming output scanning**
- Streamed (SSE) responses are no longer a governance hole: an inline masker
  rewrites assistant deltas as they flow, with a carry buffer so PII/secrets
  split across chunks (or Write boundaries) are still caught. Fail-open; flushes
  held content if the upstream ends without `[DONE]`. Covered by 7 unit tests.

**5. Secrets & transport**
- File-based secret loading (`<KEY>_FILE` — Vault/K8s/Docker-secrets convention)
  for admin token, signing secret, provider key, OIDC secret. Production guard:
  refuses to start with public default secrets when `APP_ENV=production`.
- gRPC TLS now turnkey: `scripts/gen-certs.sh` (portable, SAN-correct) +
  `docker-compose.tls.yml` overlay; ML server fails closed on a missing cert.
  Corrected comments that overclaimed "mTLS" (it is one-way TLS).

**Verified live this session:** cert generates with correct SAN and the Go gRPC
client loads it; streaming masker tests pass (incl. cross-chunk SSN/card);
efficacy benchmark runs both configs and writes reports; gateway build + full Go
suite green.

**Honest gaps remaining for full GA:** true mTLS (client certs), the 4 "Preview"
tabs (Team is now live; Billing/Vulnerabilities/Sandboxes still need backends),
published load/SLO numbers, third-party pentest + SOC2 certification of the
product itself.

## 2026-06-14 — Investor-Demo Readiness Session

Goal: enterprise-grade, everything-running-together, dashboard-configurable,
seamless. Built a true runtime-configuration plane and wired the control plane
to it; verified live against CockroachDB + Redis.

**Runtime settings plane (the headline "configurable from the dashboard")**
- New `gateway/internal/settings` Manager: DB-persisted JSON document seeded
  from config/env, in-memory snapshot, apply-hooks, clamping/validation.
  Migration `006_settings.sql` + `store.{Get,Save}SettingsRaw`.
- `GET/PUT /admin/v1/settings`. Rate limiter (RPM/TPM) and cache TTL made
  atomic with `SetLimits`/`SetTTL`; proxy reads live settings for analyzer
  timeout, output scan, TPM gate, failover toggle, and audit-all gating.
- ML engine gained a runtime config plane (`runtime_config.py` + `GET/POST
  /config` on the embed server); toxicity enablement/threshold, code-leak
  block, PII master switch and per-entity Presidio allowlist are all live.
  The gateway pushes the ML subset on every change (fail-open).

**Dashboard wiring + honesty pass**
- Settings tab (Security Defaults + General) and Data Privacy tab now load
  from / persist to the live plane; Edge Routing failover is a live toggle.
- Replaced fake toggles with real gates; removed hardcoded dev token/localhost
  from help text; centralized gateway base URL; relabeled non-backed tabs
  "Demo data" → "Preview"/"Reference".

**Robustness**
- Plugin-runtime init is now non-fatal (degrades to disabled stage).
- New `/ready` readiness probe (DB hard dep; Redis/ML reported).
- Turnkey `gateway/.env` scaffold (one line to paste a key); smoke.sh asserts
  /ready + a settings PUT round-trip.

**Verified live:** gateway boots clean, all 6→7 migrations apply incl. 006;
settings GET/PUT round-trip with clamping (99999→10000) and per-entity merge;
overrides persist across a gateway restart (reload from DB); `/ready` green;
full Go suite + `next build` green; ML push fails open when engine absent.

**Remaining manual step for the demo:** paste a provider key into
`gateway/.env` (GROQ_API_KEY=...), then `docker compose up -d --build`.

## 2026-06-13 — Finish-Everything-Remaining Session

Closed every remaining gap and roadmap item. All committed; full Go + Python
suites green; 12/12 smoke; stack verified live.

- **Real injection ML layer** — shipped a 188-sample trained corpus so the
  TF-IDF fallback activates; switched the transformer to the public
  `protectai/deberta-v3-base-prompt-injection-v2` (v1 went gated/401). Novel
  non-regex injections now detected.
- **Dynamic audit attribution** — provider derived from upstream host, model
  parsed from the request body (was hardcoded Groq/llama3-8b).
- **Real local sandbox isolation** — `analyzer/core/sandbox.py` now reaches
  Docker (Desktop socket discovery) and the seccomp allowlist gained the modern
  runc/glibc syscalls it needed to start; verified net-none + read-only rootfs.
- **Response-side output scanning** — masks PII/secrets the model emits
  (`OUTPUT_SCAN_ENABLED`, `X-Titan-Output-Masked`, audit `OUTPUT_MASKED`).
  Bumped inline `ANALYZER_TIMEOUT_MS` 150→500 so the now-active transformer
  reliably gates requests instead of failing open.
- **WASM custom-rule plugins** — wazero stage running operator `.wasm` detectors
  (`PLUGIN_DIR`); sample blocks internal codenames. Verified 403 live.
- **Grafana** over ClickHouse (provisioned datasource + TITAN Overview, :3001),
  **load/stress harness** (`loadtest/`), **AWS EKS Terraform** (`terraform/`).
- Docs reorganized under `docs/MD_FILES/`; `.DS_Store` files untracked + ignored.

---

## 2026-06-13 — Demo-Readiness Session (claude_v1_handoff.md executed)

The handoff plan was largely already shipped; this session closed the real gaps
and — critically — ran the full stack live for the first time, which surfaced
several latent faults that would have broken the client demo:

**New work**
- Python ML engine OTel tracing (`ml_engine/analyzer/telemetry.py`): opt-in,
  gRPC context extraction, spans around Injection/Toxicity/PII scans
- Jaeger all-in-one in compose (UI :16686); gateway + ml_engine export OTLP
- Gateway → ML engine trace propagation (otelgrpc) and W3C traceparent
  injection into upstream LLM requests
- Dashboard Analytics tab now renders live ClickHouse data (new
  `/api/gateway/analytics` proxy route, Live badge, demo-data fallback)
- `scripts/smoke.sh` — 12-point pre-demo verification; `DEMO.md` — runbook

**Latent faults found by live E2E and fixed**
- ClickHouse client sent form-encoded body (parsed as SQL) → every
  /api/analytics/* call failed; params now in URL, SQL in body
- No baseline ALLOW seed policy → Cedar default-denied *every* request
- `audit_logs` topic never created → audit events silently dropped
  (redpanda auto_create_topics now enabled + topic created)
- Gateway image was `FROM scratch` but healthcheck used wget → never
  healthy → dashboard (depends_on healthy) could never start; now alpine
- gateway Dockerfile pinned Go 1.23 vs go.mod 1.26 → image build failed
- dashboard lockfile out of sync + unsupported `npm ci --frozen-lockfile`
- qdrant/jaeger/clickhouse healthchecks unusable (no wget in image / IPv6
  localhost); ml_engine now binds host HF cache (offline, fast cold start)
- 3 injection-detector heuristic gaps (DAN ordering, "disable your safety",
  "reveal the instructions you were given")

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
| 7 | Titan V2 — Cedar, Firecracker, CockroachDB migration | Done |
| 8 | Multi-Region Active-Active Deployment | Done (Helm chart + region overlays; cluster provisioning/Terraform out of scope) |
| 9 | OpenTelemetry Observability | Done |
| 10 | ClickHouse Analytics Layer | Done |

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

- [x] **1. Cedar Policy Engine** — DONE. `gateway/internal/policy/engine.go` evaluates real Cedar via `github.com/cedar-policy/cedar-go` (pure-Go AWS implementation): DB policies compile to Cedar text (or use the pre-computed `cedar_text` column), forbid-wins + default-deny semantics, 30s cache refresh. The old `cedar.go` stub was dead code and has been removed.
- [x] **2. Firecracker MicroVM Sandbox** — DONE. `analyzer/core/firecracker_backend.py` boots a throwaway Firecracker microVM per command via the API socket (KVM hardware isolation, no NIC, read-only rootfs; command via `titan_cmd=<b64>` boot arg, output via serial sentinels). Auto-selected when `/dev/kvm` + binary + kernel + rootfs are present (`FIRECRACKER_BIN`/`FC_KERNEL_IMAGE`/`FC_ROOTFS`); falls back to hardened-Docker, then simulated. Rootfs tooling: `analyzer/core/firecracker/{build_rootfs.sh,titan-init.sh}`. Requires a Linux/KVM host to activate — verified here to probe-and-fallback correctly.
- [x] **3. ClickHouse Analytics DB** — DONE. ClickHouse ingests the `audit_logs` topic natively (Kafka engine table + MV → MergeTree, 90-day TTL, monthly partitions — `platform/clickhouse/init.sql`). Gateway read path: `internal/analytics/clickhouse.go` (HTTP interface, parameterized queries) exposed at `/api/analytics/{overview,timeseries,threats}`; answers 503 when `CLICKHOUSE_URL` unset. Compose includes the `clickhouse` service.
- [x] **4. Metrics Persistence** — DONE (Phase 2 session). `gateway/internal/metrics/reporter.go` flushes counters/latencies/traffic to Redis every 5s; `GlobalSnapshot()`/`GlobalEvents()` give cluster-wide views with local fallback.

### Medium Priority

- [x] **5. Semantic Caching via Qdrant** — DONE. `cache/semantic.go` uses Qdrant REST API + ML engine embedding endpoint. `all-MiniLM-L6-v2` generates 384-dim vectors; cosine similarity ≥ 0.95 (configurable) triggers a hit. Docker Compose now includes Qdrant. Falls back gracefully if Qdrant/embedding unavailable.
- [x] **6. Token-Based Rate Limiting** — DONE. Added `AllowTokens()` TPM method to `ratelimit.go` (1-min tumbling Redis bucket). Proxy checks TPM in Stage 3 after RPM. Enable via `RATE_LIMIT_TPM=<n>` env var (0 = disabled). Returns `X-RateLimit-Tokens-Remaining` header.
- [x] **7. Toxicity / Sentiment Detection** — DONE. `ml_engine/analyzer/toxicity_detector.py`: two-layer (heuristic lexicon + optional `unitary/toxic-bert`) BLOCK gate wired after injection. Configurable via `TOXICITY_ENABLED` / `TOXICITY_BLOCK_THRESHOLD`.
- [x] **8. Source Code Leak Prevention** — DONE. `ml_engine/analyzer/secret_scanner.py`: masks hardcoded credentials (`<SECRET:LABEL>`) and detects large source-code pastes via a density heuristic. Composed into the same per-message masking pass as PII. `CODE_LEAK_BLOCK=true` blocks code pastes; default flags + raises risk.
- [x] **9. Multi-Provider Failover / Smart Routing** — DONE. Added `FallbackTargetURL` + `FallbackAPIKey` config (env vars). Proxy builds a second `httputil.ReverseProxy`; `ModifyResponse` triggers failover on 502/503/504; `ErrorHandler` replays request body (stored in context) to fallback. Logs a warning on failover.
- [x] **10. OpenTelemetry (OTel) Observability** — DONE. `gateway/internal/telemetry/otel.go`: OTLP/HTTP trace exporter + W3C TraceContext/Baggage propagation, one server span per request via `otelhttp` middleware (first in the chain). Fully opt-in — no-op with zero overhead unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set; honours standard `OTEL_*` env vars.

### Lower Priority

- [x] **11. Integration Test Coverage** — DONE (load/stress excluded). `internal/integration/pipeline_test.go`: E2E auth→Cedar→audit→cursor→compliance pipeline + multi-tenant isolation tests, verified green against live CockroachDB (skip gracefully when no DB; `DB_TEST_CONN_STRING` enables). `internal/events/consumer_test.go` covers the Kafka→DB row mapping incl. malformed-UUID degradation. Bonus production fix found by these tests: migration 004's same-transaction column+index broke fresh CockroachDB boots — split into 004/004b.
- [x] **12. Multi-Region K8s Deployment** — DONE (Helm). `helm/titan/` chart deploys gateway + ML engine + dashboard with HPA, zone topology-spread, probes, secret management and per-region overlays (`regions/us-east.yaml`, `regions/eu-west.yaml`). Multi-region topology documented in the chart README: one release per region, region-local Redis/Kafka/ClickHouse, shared CockroachDB cluster via regional endpoints, `REGION` flows into audit events + Cedar context. Lints and templates clean (helm 4.2). Terraform for cluster provisioning remains out of scope.
- [x] **13. Audit Log Query Performance** — DONE. Keyset pagination: `ListAuditEventsCursor` seeks `(created_at, id)` row-value comparisons against new composite indexes (migration 005); `GET /admin/v1/audit?cursor=<opaque>` returns `next_cursor` (base64url, "" = end). O(limit) at any depth, stable under inserts, and skips the COUNT(*) query. Offset mode kept for legacy callers.
- [x] **14. Compliance Reporting** — DONE. `GET /admin/v1/compliance/report` (period summary: totals, action/region breakdowns, risk stats, attestations) and `GET /admin/v1/compliance/export?format=csv|jsonl` (full audit-trail export streamed in bounded memory via keyset paging — CSV for auditors, JSON Lines for SIEM).
- [x] **15. OpenAPI/Swagger Docs** — DONE. Embedded OpenAPI 3.0 spec (`gateway/internal/api/openapi.json`) served at `/openapi.json` with Swagger UI at `/docs` (top-level, bypassing admin auth). Covers admin API, read API, proxy and batch.
- [x] **16. Client SDKs** — DONE. `sdk/python` (stdlib `TitanClient`) and `sdk/node` (ESM over fetch + `.d.ts`) wrap the full Admin API + read API.
- [x] **17. gRPC Schema Versioning** — DONE. `ml_engine/proto/README.md` documents the full policy (additive-only within `analyzer.v1`, `reserved` on deletion, breaking changes ship as side-by-side `analyzer.v2`, retirement criteria) and `buf.yaml` enforces it (`buf lint` + `buf breaking` with WIRE_JSON against git).
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
**Resolved (Phase 10, 2026-06-08):** The former in-memory audit queue (`EnqueueAudit`, which dropped rows at 4096 capacity under DB slowdown) was removed. Kafka/Redpanda is now the durable audit write-ahead log: the request path fire-and-forgets to the `audit_logs` topic, and a consumer group persists to the DB at-least-once (offsets committed only after `InsertAuditBatch`; `event_id` + a partial unique index dedupe redelivery). Audit events are no longer dropped under DB back-pressure.

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
| `README.md` | Surfaced the new features in Features / Service Endpoints / Roadmap. |
| `.gitignore` | Ignore Python bytecode; untracked 20 previously-committed `__pycache__/*.pyc` files. |

**Items completed:** #7 (Toxicity), #8 (Source-code leak), #15 (OpenAPI/Swagger), #16 (Client SDKs), #18 (Batch API)

**Verification:** `go build ./...` + `go test ./...` green (new batch tests pass); the full `AnalyzePrompt` composition path exercised end-to-end (clean→ALLOW, pii/secret/both→MASK with combined tags, toxic/inject→BLOCK); both SDKs instantiate; `openapi.json` validates. All work pushed to `origin/main`.

**Remaining items:** #1 (Cedar), #2 (Firecracker), #3 (ClickHouse), #10 (OTel), #17 (gRPC versioning), plus test/infra items.

### 2026-06-10 — Project Completion Session
**Input:** "Finish up this project — do what's remaining, push after every change."

All remaining pending items (#1–#18) closed this session, one commit per item:

| Commit | Item | Summary |
|---|---|---|
| `1842efd` | #1, #4 | Removed dead `cedar.go` stub (real Cedar via cedar-go already lived in `engine.go`); ticked stale metrics-persistence checkbox |
| `f0d07b2` | #3 | ClickHouse OLAP layer: Kafka-engine ingest (`platform/clickhouse/init.sql`), gateway HTTP read client, `/api/analytics/{overview,timeseries,threats}`, compose service |
| `d1317d9` | #10 | OpenTelemetry tracing: OTLP/HTTP exporter + otelhttp middleware, opt-in via standard `OTEL_*` env vars |
| `6f76e6a` | #13 | Keyset cursor pagination for audit logs (migration 005, `?cursor=` + `next_cursor`) |
| `885b199` | #14 | Compliance report + CSV/JSONL audit export (`/admin/v1/compliance/*`) |
| `4d232e8` | #17 | gRPC versioning policy (`ml_engine/proto/README.md`) + buf lint/breaking config |
| `e7e5f3b` | #2 | True Firecracker microVM backend (API socket, serial-sentinel protocol, rootfs build tooling) with docker→simulated fallback chain |
| `d9aee60` | #12 | Helm chart `helm/titan/` with multi-region overlays, HPA, topology spread |
| `429a0c0` | #11 | E2E pipeline + multi-tenant isolation integration tests (verified live on CockroachDB) + **production bugfix**: migration 004 broke fresh CockroachDB boots (same-txn column+partial-index); split into 004/004b |

**Toolchain set up this session:** Go 1.26.4 (winget), Helm 4.2 (winget).

**Environment caveats:** Firecracker backend needs a Linux/KVM host to activate (probe-and-fallback verified here). ClickHouse ingestion configured for the compose topology (`redpanda:29092`); verified via schema review, not a live ClickHouse boot.

**Remaining (explicitly out of scope, tracked in README "Planned"):** load/stress tests, Terraform/cluster provisioning, Grafana dashboards.

---

## How to Continue

1. Read this file at the start of each session for full context.
2. Pick a pending item from the list above.
3. When work is done, mark the item `[x]` and add a new entry to the **Session Log** section above.

