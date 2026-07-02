# Native Installer — Phase 0: Home Runtime Profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the existing Gateway/Dashboard/ML-engine codebase can run correctly with Kafka, ClickHouse, Qdrant, and ASR all absent (the "Home" profile a future Docker-free native installer will use), before spending any effort on Tauri packaging.

**Architecture:** No new services and no behavior changes — this phase only adds tests, documentation, and a dev-convenience script that exercise code paths that already exist (the direct-to-DB audit fallback, the already-graceful ClickHouse/ASR/Qdrant degradation). It closes out the specific gaps flagged in the design doc's review pass, and produces the machine-readable manifest later phases (Tauri process supervisor) will consume.

**Tech Stack:** Go 1.26 (gateway, `testify`-free stdlib `testing`), Next.js 16 dashboard (Node scripts, no new test framework), Node.js dev scripts, POSIX shell.

**Spec:** `docs/superpowers/specs/2026-07-01-native-desktop-installer-design.md` — this plan implements that spec's "Phase 0 — Native runtime profile" section and the Gap Resolution #1 action item.

## Global Constraints

- No Docker Compose changes in this phase — Docker-based dev/CI stays exactly as it is today. Everything added here is additive.
- `KAFKA_BROKERS=` (empty string, not omitted) is the documented way to disable Kafka — confirmed at `gateway/internal/config/config.go:318-326` (`splitComma("")` returns an empty slice) and `gateway/cmd/server/main.go:207` (`if len(cfg.KafkaBrokers) > 0`).
- New Go tests must use `testhelper.OpenTestDBOrSkip(t)` (from `gateway/internal/testhelper/db.go`) so the suite stays green on machines without a test database, matching existing tests like `gateway/internal/api/admin_security_test.go`.
- Follow existing test file placement: same package as the code under test, new test functions added to an existing `_test.go` file when one already covers the same handler/type, otherwise a new file next to it.
- Dashboard has no unit-test framework configured (`dashboard/package.json` only has `test:auth` — a static Node script — and `test:e2e` — Playwright). Do not introduce a new test framework for one check; follow the `test:auth`/`verify-admin-auth.mjs` static-source-assertion pattern already in the repo.

---

### Task 1: Home environment profile files (gateway + dashboard)

**Files:**
- Create: `gateway/.env.home.example`
- Create: `dashboard/.env.home.example`

**Interfaces:**
- Consumes: existing `gateway/internal/config/config.go` env var names (`LISTEN_ADDR`, `DB_CONN_STRING`, `REDIS_ADDR`, `ANALYZER_ADDR`, `EMBEDDING_URL`, `KAFKA_BROKERS`, `CLICKHOUSE_URL`, `QDRANT_URL`, `ASR_URL`, `ADMIN_TOKEN`, `AUTH_SIGNING_SECRET`, `DEFAULT_ADMIN_EMAIL`, `DEFAULT_ADMIN_PASSWORD`, `DASHBOARD_URL`, `ADMIN_ALLOWED_ORIGINS`) and dashboard's `NEXT_PUBLIC_GATEWAY_URL` / `ADMIN_TOKEN` (`dashboard/src/lib/gateway.ts:7-8`).
- Produces: the documented env shape Task 6's `scripts/home-dev.sh` and Phase 1's Tauri wizard will both read from.

This is a documentation-only task (no test cycle needed beyond "the file parses as env syntax and the gateway starts with it" — that's exercised by Task 6). Steps:

- [ ] **Step 1: Write `gateway/.env.home.example`**

```env
# Home profile — no Kafka, no ClickHouse, no Qdrant, no ASR, everything on
# localhost. Copy to gateway/.env for a Docker-free local run:
#   cp gateway/.env.home.example gateway/.env
#
# KAFKA_BROKERS must be an EMPTY value, not omitted — omitting it falls back
# to the "localhost:9092" default and the gateway will try (and fail) to
# reach Kafka. An empty value makes len(cfg.KafkaBrokers) == 0, which routes
# every audit write through the direct-to-DB fallback instead.
KAFKA_BROKERS=

# Leave empty to disable — the gateway degrades these features cleanly
# (analytics endpoints return 503, semantic cache and ASR sandbox stay off).
CLICKHOUSE_URL=
QDRANT_URL=
ASR_URL=

LISTEN_ADDR=127.0.0.1:8080
DB_CONN_STRING=postgresql://root@127.0.0.1:26257/defaultdb?sslmode=disable
REDIS_ADDR=127.0.0.1:6379
ANALYZER_ADDR=127.0.0.1:50051
EMBEDDING_URL=http://127.0.0.1:8001/embed
DASHBOARD_URL=http://127.0.0.1:3000
ADMIN_ALLOWED_ORIGINS=http://127.0.0.1:3000

# Generate real secrets before using this outside a throwaway local run:
#   openssl rand -hex 32
ADMIN_TOKEN=your-admin-token-here
AUTH_SIGNING_SECRET=your-signing-secret-here

# Wizard-collected values in the future native installer; safe placeholders
# for local dev.
DEFAULT_ADMIN_EMAIL=admin@titan.local
DEFAULT_ADMIN_PASSWORD=change-me-please

GROQ_API_KEY=your-groq-api-key-here
```

- [ ] **Step 2: Write `dashboard/.env.home.example`**

```env
# Home profile — matches gateway/.env.home.example. Copy to dashboard/.env.local:
#   cp dashboard/.env.home.example dashboard/.env.local
NEXT_PUBLIC_GATEWAY_URL=http://127.0.0.1:8080
ADMIN_TOKEN=your-admin-token-here
```

- [ ] **Step 3: Commit**

```bash
git add gateway/.env.home.example dashboard/.env.home.example
git commit -m "docs: add Home profile env examples (no Kafka/ClickHouse/Qdrant/ASR)"
```

---

### Task 2: Prove the proxy's data-plane audit path survives Kafka being absent

**Files:**
- Create: `gateway/internal/proxy/home_profile_test.go`

**Interfaces:**
- Consumes: `testhelper.OpenTestDBOrSkip(t) *store.Store` (`gateway/internal/testhelper/db.go:34`); `LLMProxy.emitKafka(reqID string, tenantID, apiKeyID uuid.UUID, action string, risk float64, path string, statusCode int, latencyMs int64, reason, region, model string)` (`gateway/internal/proxy/proxy.go:842-861`, unexported, same-package test); `Store.ListAuditEvents(ctx, tenantID *uuid.UUID, limit, offset int) ([]AuditEventRow, int, error)` (`gateway/internal/store/audit.go:38`).
- Produces: nothing new consumed by later tasks — this is a standalone regression test.

- [ ] **Step 1: Write the failing test**

```go
package proxy

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/sharvik/llm-firewall/gateway/internal/testhelper"
)

// TestEmitKafka_NoBrokerConfigured_PersistsDirectlyToDB proves the Home
// profile's core assumption: with KAFKA_BROKERS="" (producer nil), audit
// events for the data-plane proxy path still land in CockroachDB via the
// direct fallback path, not just when Kafka is up.
func TestEmitKafka_NoBrokerConfigured_PersistsDirectlyToDB(t *testing.T) {
	st := testhelper.OpenTestDBOrSkip(t)

	p := &LLMProxy{st: st, provider: "Groq"} // producer left nil on purpose

	reqID := uuid.New().String()
	tenantID := uuid.New()

	p.emitKafka(reqID, tenantID, uuid.Nil, "ALLOW", 12.5,
		"/v1/chat/completions", 200, 42, "", "", "llama-3.1-8b-instant")

	// persistAuditFallback writes in a background goroutine; poll briefly
	// rather than sleeping a fixed amount.
	deadline := time.Now().Add(2 * time.Second)
	for {
		rows, _, err := st.ListAuditEvents(context.Background(), &tenantID, 10, 0)
		if err != nil {
			t.Fatalf("ListAuditEvents: %v", err)
		}
		if len(rows) == 1 {
			if rows[0].RequestID != reqID {
				t.Fatalf("RequestID = %q, want %q", rows[0].RequestID, reqID)
			}
			if rows[0].Action != "ALLOW" {
				t.Fatalf("Action = %q, want ALLOW", rows[0].Action)
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected 1 audit row for tenant %s, got %d after waiting", tenantID, len(rows))
		}
		time.Sleep(50 * time.Millisecond)
	}
}
```

- [ ] **Step 2: Run test to verify it fails without a test DB, and passes with one**

Run: `cd gateway && DB_TEST_CONN_STRING="postgresql://root@localhost:26257/titan_test?sslmode=disable" go test ./internal/proxy/ -run TestEmitKafka_NoBrokerConfigured_PersistsDirectlyToDB -v`

Expected (no CockroachDB reachable): `SKIP` with message `integration test skipped — test DB unreachable`.
Expected (CockroachDB reachable, before any fix — there is no fix needed, this proves existing behavior): `PASS`. If it fails, the failure is real: it means `emitKafka`'s existing fallback path is broken, which would also be a Docker-mode regression, not just a Home-profile one.

- [ ] **Step 3: Commit**

```bash
git add gateway/internal/proxy/home_profile_test.go
git commit -m "test(proxy): prove data-plane audit survives KAFKA_BROKERS= (Home profile)"
```

---

### Task 3: Prove the Browser DLP audit path survives Kafka being absent

**Files:**
- Modify: `gateway/internal/api/browser_dlp_test.go` (add a test function; existing file already covers `Report`/`mapBrowserAction`)

**Interfaces:**
- Consumes: `testhelper.OpenTestDBOrSkip(t)`; `NewBrowserDLPHandler(producer *events.EventProducer, dispatcher *alerts.Dispatcher, st *store.Store, threshold int, token string) *BrowserDLPHandler` (`gateway/internal/api/browser_dlp.go:44`); `(*BrowserDLPHandler).Report(w http.ResponseWriter, r *http.Request)` (`browser_dlp.go:95`); `Store.ListAuditEvents` (same as Task 2).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing test**

Add to `gateway/internal/api/browser_dlp_test.go` (new imports needed: `context`, `time`, `"github.com/sharvik/llm-firewall/gateway/internal/testhelper"` — add alongside the existing `net/http`, `net/http/httptest`, `strings`, `testing` imports):

```go
// TestBrowserDLPReport_NoBrokerConfigured_PersistsDirectlyToDB proves the
// Home profile's assumption for the browser-extension audit path: with no
// Kafka producer, a DLP report handled by Report() still lands a durable
// audit row in CockroachDB via the direct fallback.
func TestBrowserDLPReport_NoBrokerConfigured_PersistsDirectlyToDB(t *testing.T) {
	st := testhelper.OpenTestDBOrSkip(t)
	h := NewBrowserDLPHandler(nil, nil, st, 3, "") // producer nil on purpose

	body := `{"site":"chatgpt","decision":"block","action":"blocked","risk":80,"reason":"prompt injection"}`
	req := httptest.NewRequest(http.MethodPost, "/internal/dlp-event", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Report(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d (%s)", rec.Code, rec.Body.String())
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		rows, _, err := st.ListAuditEvents(context.Background(), nil, 20, 0)
		if err != nil {
			t.Fatalf("ListAuditEvents: %v", err)
		}
		for _, row := range rows {
			if row.Action == "BROWSER_DLP_BLOCK" {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected a BROWSER_DLP_BLOCK audit row after waiting, got %d total rows", len(rows))
		}
		time.Sleep(50 * time.Millisecond)
	}
}
```

- [ ] **Step 2: Run test to verify behavior**

Run: `cd gateway && DB_TEST_CONN_STRING="postgresql://root@localhost:26257/titan_test?sslmode=disable" go test ./internal/api/ -run TestBrowserDLPReport_NoBrokerConfigured_PersistsDirectlyToDB -v`

Expected: `SKIP` without a reachable test DB; `PASS` with one.

- [ ] **Step 3: Commit**

```bash
git add gateway/internal/api/browser_dlp_test.go
git commit -m "test(browser-dlp): prove audit survives KAFKA_BROKERS= (Home profile)"
```

---

### Task 4: Dashboard runtime-config regression test (Gap Resolution #1 guardrail)

**Files:**
- Create: `dashboard/scripts/verify-gateway-runtime-config.mjs`
- Modify: `dashboard/package.json:7-9` (add a script entry)

**Interfaces:**
- Consumes: `dashboard/src/lib/gateway.ts` source text (static inspection, same technique as the existing `dashboard/scripts/verify-admin-auth.mjs`).
- Produces: a `npm run test:home-profile` command usable in CI.

This guards the fact established in the design doc's Gap Resolution #1: `GATEWAY` in `dashboard/src/lib/gateway.ts:7` is only ever imported by server-side `app/api/**/route.ts` handlers, never a client component — which is what makes it safe to pick a non-default Gateway port at runtime with no rebuild. This test fails loudly if a future change adds a client-side import.

- [ ] **Step 1: Write the script**

```javascript
// dashboard/scripts/verify-gateway-runtime-config.mjs
//
// Guards a load-bearing assumption for the Home installer: dashboard/src/lib/gateway.ts's
// GATEWAY constant reads NEXT_PUBLIC_GATEWAY_URL via process.env at runtime, which only
// works because every importer is a server-side route handler. If a client component
// ('use client') ever imports GATEWAY, Next.js inlines the build-time value into the
// browser bundle and the Home installer's "auto-pick a free Gateway port" wizard step
// silently breaks. See docs/superpowers/specs/2026-07-01-native-desktop-installer-design.md,
// Gap Resolution #1.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const gatewaySource = readFileSync(join(root, 'src/lib/gateway.ts'), 'utf8');
assert(
  gatewaySource.includes("process.env.NEXT_PUBLIC_GATEWAY_URL"),
  'GATEWAY must read NEXT_PUBLIC_GATEWAY_URL from process.env so a runtime-written env file works',
);

// Walk src/app looking for any file that imports '@/lib/gateway' (directly or via a
// re-export) AND declares 'use client' — that combination is what breaks runtime
// configurability.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

const files = walk(join(root, 'src'));
const offenders = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const importsGateway = /from ['"]@\/lib\/gateway['"]/.test(src);
  const isClientComponent = /^\s*['"]use client['"]/.test(src);
  if (importsGateway && isClientComponent) offenders.push(file);
}

assert.equal(
  offenders.length,
  0,
  `these client components import '@/lib/gateway' and will bake NEXT_PUBLIC_GATEWAY_URL ` +
  `at build time, breaking runtime port selection: ${offenders.join(', ')}`,
);

console.log('verify-gateway-runtime-config: OK — GATEWAY stays server-side, runtime-configurable');
```

- [ ] **Step 2: Run it to verify it currently passes**

Run: `cd dashboard && node scripts/verify-gateway-runtime-config.mjs`
Expected: prints `verify-gateway-runtime-config: OK ...` and exits 0 (confirmed manually during design review that no client component currently imports `@/lib/gateway`).

- [ ] **Step 3: Prove it actually catches the regression it's meant to catch**

Temporarily add `'use client'` plus `import { GATEWAY } from '@/lib/gateway';` to the top of any existing component file (e.g. a scratch copy), rerun the script, confirm it fails with the expected assertion message, then discard the temporary edit — do not commit it.

- [ ] **Step 4: Wire into package.json**

In `dashboard/package.json`, change:

```json
    "test:auth": "node scripts/verify-admin-auth.mjs",
    "test:e2e": "playwright test"
```

to:

```json
    "test:auth": "node scripts/verify-admin-auth.mjs",
    "test:home-profile": "node scripts/verify-gateway-runtime-config.mjs",
    "test:e2e": "playwright test"
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/scripts/verify-gateway-runtime-config.mjs dashboard/package.json
git commit -m "test(dashboard): guard GATEWAY runtime-configurability for Home profile"
```

---

### Task 5: Machine-readable service manifest for the future native supervisor

**Files:**
- Create: `platform/home/service-manifest.json`

**Interfaces:**
- Produces: the schema Phase 1/3 (Tauri process supervisor) will parse to know which binaries to launch, in what order, on which ports, with which health checks — directly reflecting the design doc's "Runtime topology" and "Process Supervision" tables.

- [ ] **Step 1: Write the manifest**

```json
{
  "$schema": "https://titan.local/schemas/home-service-manifest-v1.json",
  "profile": "home",
  "startOrder": ["cockroachdb", "redis", "ml_engine", "gateway", "dashboard"],
  "shutdownOrder": ["dashboard", "gateway", "ml_engine", "redis", "cockroachdb"],
  "services": {
    "cockroachdb": {
      "bind": "127.0.0.1",
      "port": 26257,
      "required": true,
      "healthCheck": { "type": "tcp", "port": 26257 }
    },
    "redis": {
      "bind": "127.0.0.1",
      "port": 6379,
      "required": true,
      "healthCheck": { "type": "tcp", "port": 6379 }
    },
    "ml_engine": {
      "bind": "127.0.0.1",
      "grpcPort": 50051,
      "httpPort": 8001,
      "required": true,
      "healthCheck": { "type": "http", "url": "http://127.0.0.1:8001/health" }
    },
    "gateway": {
      "bind": "127.0.0.1",
      "port": 8080,
      "required": true,
      "healthCheck": { "type": "http", "url": "http://127.0.0.1:8080/health" },
      "readyCheck": { "type": "http", "url": "http://127.0.0.1:8080/ready" }
    },
    "dashboard": {
      "bind": "127.0.0.1",
      "port": 3000,
      "required": true,
      "healthCheck": { "type": "http", "url": "http://127.0.0.1:3000/login" }
    }
  },
  "disabledInHomeProfile": ["kafka", "clickhouse", "qdrant", "asr", "jaeger", "grafana"],
  "envFiles": {
    "gateway": "gateway/.env.home.example",
    "dashboard": "dashboard/.env.home.example"
  }
}
```

- [ ] **Step 2: Validate it's syntactically correct JSON**

Run: `python3 -m json.tool platform/home/service-manifest.json > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add platform/home/service-manifest.json
git commit -m "docs: add Home profile service manifest for the future native supervisor"
```

---

### Task 6: Single-command Home profile dev launcher (no Docker)

**Files:**
- Create: `scripts/home-dev.sh`

**Interfaces:**
- Consumes: `gateway/.env.home.example`, `dashboard/.env.home.example` (Task 1); a locally installed `cockroach` and `redis-server` on `PATH` (documented prerequisite for this dev-only script — packaging real bundled binaries is Phase 1's job, not this one).
- Produces: the "single command starts the Home profile without Docker" proof the spec's Phase 0 Definition of Done requires, for developers only (not yet an end-user installer).

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Starts the TITAN "Home" profile (no Docker, no Kafka/ClickHouse/Qdrant/ASR)
# directly from source, for developers proving out the Home runtime profile
# ahead of the native installer (see docs/superpowers/specs/2026-07-01-native-desktop-installer-design.md).
#
# Prerequisites (not installed by this script):
#   - cockroach and redis-server on PATH (e.g. `brew install cockroachdb/tap/cockroach redis`)
#   - Go 1.26+, Python 3.12 with ml_engine/requirements.txt installed, Node 20+

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT/.home-dev-data"
PIDS=()

cleanup() {
  echo ""
  echo "Stopping Home profile..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

command -v cockroach >/dev/null 2>&1 || { echo "ERROR: cockroach not found on PATH." >&2; exit 1; }
command -v redis-server >/dev/null 2>&1 || { echo "ERROR: redis-server not found on PATH." >&2; exit 1; }

mkdir -p "$DATA_DIR/cockroach"

echo "Starting CockroachDB (single-node, insecure, localhost-only)..."
cockroach start-single-node --insecure --listen-addr=127.0.0.1:26257 \
  --http-addr=127.0.0.1:8090 --store="$DATA_DIR/cockroach" \
  > "$DATA_DIR/cockroach.log" 2>&1 &
PIDS+=($!)

echo "Starting Redis (localhost-only)..."
redis-server --bind 127.0.0.1 --port 6379 --save "" \
  > "$DATA_DIR/redis.log" 2>&1 &
PIDS+=($!)

wait_for_tcp() {
  local host="$1" port="$2" label="$3" elapsed=0
  until (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; do
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge 30 ]; then
      echo "ERROR: $label did not come up on $host:$port after 30s" >&2
      exit 1
    fi
    sleep 1
  done
  exec 3>&- 3<&- 2>/dev/null || true
}

wait_for_tcp 127.0.0.1 26257 "CockroachDB"
wait_for_tcp 127.0.0.1 6379 "Redis"

echo "Starting ML Engine..."
( cd "$ROOT/ml_engine" && GRPC_PORT=50051 EMBED_PORT=8001 python -m analyzer.server ) \
  > "$DATA_DIR/ml_engine.log" 2>&1 &
PIDS+=($!)

wait_for_tcp 127.0.0.1 50051 "ML Engine gRPC"

echo "Starting Gateway..."
( cd "$ROOT/gateway" && set -a && source .env.home.example && set +a && go run ./cmd/server ) \
  > "$DATA_DIR/gateway.log" 2>&1 &
PIDS+=($!)

wait_for_tcp 127.0.0.1 8080 "Gateway"

echo "Starting Dashboard..."
( cd "$ROOT/dashboard" && set -a && source .env.home.example && set +a && npm run dev ) \
  > "$DATA_DIR/dashboard.log" 2>&1 &
PIDS+=($!)

wait_for_tcp 127.0.0.1 3000 "Dashboard"

echo ""
echo "Home profile is up:"
echo "  Dashboard: http://127.0.0.1:3000"
echo "  Gateway:   http://127.0.0.1:8080"
echo "  Logs:      $DATA_DIR/*.log"
echo ""
echo "Press Ctrl+C to stop everything."
wait
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/home-dev.sh`

- [ ] **Step 3: Run it end-to-end and verify Definition of Done**

Run: `./scripts/home-dev.sh`

Expected, in order: CockroachDB and Redis TCP checks pass, ML Engine gRPC check passes, Gateway TCP check passes, Dashboard TCP check passes, then a summary block with the three URLs. Manually confirm:
- `curl http://127.0.0.1:8080/health` returns 200.
- `curl http://127.0.0.1:3000/login` returns 200.
- Opening the dashboard in a browser loads without console errors on Overview, Events, Audit Logs, Policies, API Keys, Settings tabs (Analytics tab is expected to show its degraded/503 state — that's correct Home-profile behavior, not a bug).

Press Ctrl+C; confirm all five background processes exit (no orphaned `cockroach`/`redis-server`/`python`/`go run`/`node` processes left with `ps aux | grep -E 'cockroach|redis-server'`).

- [ ] **Step 4: Commit**

```bash
git add scripts/home-dev.sh
git commit -m "feat(scripts): add single-command Home profile dev launcher (no Docker)"
```

---

## Definition of Done (matches the spec's Phase 0 exit criteria)

- [ ] Gateway starts with `KAFKA_BROKERS=`, `CLICKHOUSE_URL=`, `QDRANT_URL=`, `ASR_URL=` (Task 1 + Task 6).
- [ ] Dashboard loads and core tabs do not crash (Task 6, manual verification step).
- [ ] A proxy-path audit event writes directly to CockroachDB with no Kafka (Task 2).
- [ ] A browser-DLP report writes directly to CockroachDB with no Kafka (Task 3).
- [ ] A single command starts the whole Home profile without Docker (Task 6).
- [ ] The Gap Resolution #1 runtime-config assumption has a standing regression test (Task 4).
- [ ] A machine-readable manifest exists for the future native process supervisor to consume (Task 5).

## Next Steps After This Plan

Once every box above is checked, return to the spec's Phase 1 ("Package existing artifacts without GUI") and Phase 2 ("ML Engine packaging") — each is large and risky enough to deserve its own implementation plan, written after Phase 0's results are in (in particular, Phase 2 depends on measuring real packaged size/RAM/cold-start numbers this phase does not produce).
