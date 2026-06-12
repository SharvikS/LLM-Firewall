# TITAN Gateway — v1.0 Enterprise Action Plan (Agent Handoff)

**Target Audience:** Autonomous Coding Agent (Claude Code)
**Goal:** Execute the final enterprise features for TITAN Gateway to reach v1.0 Enterprise Readiness.

You must follow these highly detailed, step-by-step instructions. For every phase, modify the specific files listed, maintain existing test coverage, and add new unit tests for any new package.

---

## 🏗️ Phase 1: ClickHouse Analytics Layer
**Objective:** Move audit logging analytics from PostgreSQL to ClickHouse to support high-scale OLAP dashboard queries.

**Step 1: Update Infrastructure**
- **File:** `docker-compose.yml`
- **Action:** Add a new service for `clickhouse` using image `clickhouse/clickhouse-server:latest`. Expose ports `8123` (HTTP) and `9000` (TCP).
- **Action:** Ensure ClickHouse is on the same Docker network as Redpanda (`redpanda:9092`).

**Step 2: Create Schema Migrations**
- **File:** `gateway/sql/002_clickhouse_schema.sql` (Create new)
- **Action:** Write SQL to create a ClickHouse `Kafka` Engine table that subscribes to the Redpanda topic (e.g., `audit_events_queue`).
- **Action:** Write SQL to create a `MergeTree` table (`audit_events`) and a `Materialized View` that pulls data from the Kafka engine table into the MergeTree table.

**Step 3: Update Go Backend**
- **File:** `gateway/go.mod`
- **Action:** Run `go get github.com/ClickHouse/clickhouse-go/v2`.
- **File:** `gateway/internal/db/clickhouse.go` (Create new)
- **Action:** Write a connection manager that connects to ClickHouse using environment variables.
- **File:** `gateway/internal/api/analytics.go` (or wherever metrics/audit queries are served)
- **Action:** Refactor the API endpoints that feed the Next.js dashboard to query ClickHouse instead of Postgres. Use `GROUP BY` and `toStartOfHour()` for time-series aggregation.

---

## 🔒 Phase 2: AWS Cedar Policy Engine Integration
**Objective:** Replace the stubbed policy condition evaluator with the official Rust/Go Cedar ABAC engine.

**Step 1: Install Dependencies**
- **File:** `gateway/go.mod`
- **Action:** Run `go get github.com/cedar-policy/cedar-go`.

**Step 2: Implement the Cedar Evaluator**
- **File:** `gateway/internal/policy/cedar.go`
- **Action:** Remove the `TODO(phase-3)` stub and the simple DB string-evaluator fallback.
- **Action:** Implement `NewCedarEngine(policies []StorePolicy)`. This should iterate over the policies fetched from Postgres, map them into Cedar Policy format, and compile them into a `cedar.PolicySet`.

**Step 3: Request Context Mapping**
- **File:** `gateway/internal/proxy/proxy.go` & `gateway/internal/policy/cedar.go`
- **Action:** Before hitting the upstream LLM, map the incoming request into Cedar Entities:
  - `Principal`: The Tenant ID.
  - `Action`: e.g., `Action::"InvokeLLM"`.
  - `Resource`: e.g., `Model::"gpt-4o"`.
  - `Context`: Map attributes like IP location, risk score from ML engine, etc.
- **Action:** Call `cedar.Evaluate()` and return HTTP 403 if the decision is `Deny`.

**Step 4: Update Tests**
- **File:** `gateway/internal/policy/engine_test.go`
- **Action:** Update the test assertions to ensure Cedar's Default-Deny logic works and that condition attributes properly trigger an ALLOW.

---

## 📈 Phase 3: Metrics Persistence
**Objective:** Prevent in-memory metric loss when the Go Gateway restarts.

**Step 1: Periodic Redis Flushing**
- **File:** `gateway/internal/metrics/collector.go`
- **Action:** Modify the `Collector` struct to accept a Redis client pointer.
- **Action:** Add a `Flush(ctx context.Context)` method containing a `time.Ticker` (e.g., every 10 seconds).
- **Action:** In the flush loop, safely grab a mutex lock, read the current metrics counters (RPM, TPM, Blocked Requests), use Redis pipelining with `HINCRBY` to update the global counts, and reset the local counters.

**Step 2: Hydration on Startup**
- **File:** `gateway/internal/metrics/collector.go`
- **Action:** Add a `LoadFromStore()` method called during `NewCollector()`. It should `HGETALL` the existing metrics from Redis so the memory maps start with accurate historical data.

---

## 💻 Phase 4: Firecracker MicroVM Sandbox
**Objective:** Harden the execution sandbox by moving from Docker to Firecracker microVMs.

**Step 1: Remove Docker Dependencies**
- **File:** `ml_engine/analyzer/core/sandbox.py` (or equivalent execution script)
- **Action:** Remove any `import docker` or `subprocess.run(["docker", ...])` logic.

**Step 2: Firecracker Integration**
- **Action:** Implement an API wrapper over the Firecracker Unix socket API (usually `/tmp/firecracker.socket`).
- **Action:** Logic flow: 
  1. Generate a random VM ID.
  2. Send a `PUT /machine-config` payload configuring 1 vCPU and 128MB RAM.
  3. Send a `PUT /drives` payload pointing to a static Alpine Linux rootfs file.
  4. Send a `PUT /actions` to send `InstanceStart`.
  5. Inject the Python/Bash payload via a virtual serial port or vsock, capture the output, and immediately kill the VM process.

---

## 📡 Phase 5: OpenTelemetry (OTel)
**Objective:** Add distributed tracing across the Go Gateway, Python gRPC Engine, and LLM Upstreams.

**Step 1: Gateway Instrumentation (Go)**
- **File:** `gateway/go.mod`
- **Action:** Add `go.opentelemetry.io/otel` and the `otlptrace/otlptracegrpc` exporter.
- **File:** `gateway/cmd/server/main.go`
- **Action:** Initialize the global OTel tracer provider.
- **File:** `gateway/internal/proxy/proxy.go`
- **Action:** Start a span (`tracer.Start(ctx, "LLMProxy")`). Use `propagation.TraceContext{}.Inject()` to insert the Trace ID into the HTTP headers sent to Groq/OpenAI.

**Step 2: ML Engine Instrumentation (Python)**
- **File:** `ml_engine/requirements.txt`
- **Action:** Add `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-instrumentation-grpc`.
- **File:** `ml_engine/analyzer/server.py`
- **Action:** Use the OTel interceptor to extract the trace context from the incoming gRPC metadata (sent by the Go gateway).
- **Action:** Wrap the `PIIScanner` and `InjectionDetector` calls in local spans so that execution latency is visible in Jaeger.

**Step 3: Update Compose**
- **File:** `docker-compose.yml`
- **Action:** Add a `jaegertracing/all-in-one:latest` service exposing port `16686` for the tracing UI.

---

### Execution Rules for the Agent:
1. **Commit Frequently:** Commit after successfully passing tests for each individual phase. Do not batch everything into one giant commit.
2. **Context Cancellation:** Always pass `ctx` deeply. Any new HTTP or gRPC clients must respect timeouts.
3. **Run Tests:** After modifying Go files, run `go test ./...`. After modifying Python, run `pytest tests/`. Fix any breakages immediately before proceeding to the next step.
