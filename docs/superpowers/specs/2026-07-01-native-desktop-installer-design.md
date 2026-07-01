# Native Desktop Installer for TITAN Gateway

Status: revised draft — feasible, with a smaller "Home" runtime scope than the
full Docker stack.

Last updated: 2026-07-01

## Problem

TITAN is self-hosted, but "self-hosted" today means: install Docker Desktop,
open a terminal, run `./scripts/quickstart.sh`, read raw `docker compose`
output, and manually edit `.env` files if something goes wrong. That's fine
for an engineer, but unusable for a non-technical ("layman") self-hoster who
just wants to run TITAN on their own machine.

Goal: give that user a double-click install experience with no terminal, no
Docker, and no manual configuration files — while keeping the exact same
security/detection behavior as the existing Docker stack.

## Feasibility Summary

This can be built with the current project, but the first native installer
should not attempt to bundle the full Docker/observability stack. The current
repo already has clean enough service boundaries:

- `gateway/` is a Go data-plane/control-plane API service and can ship as a
  native binary.
- `dashboard/` is a Next.js app with standalone output and can be served by a
  bundled Node runtime.
- `ml_engine/` is the main packaging risk: Python + torch + transformers +
  Presidio + spaCy + EasyOCR + model assets.
- CockroachDB is a hard dependency because auth, tenants, API keys, policies,
  settings, and audit storage require the database.
- Redis is strongly recommended for rate limits, exact cache, metrics, batch
  state, and Enterprise metering. The gateway degrades if Redis is unavailable,
  but the Home installer should still bundle it for predictable behavior.
- Redpanda/Kafka is no longer required for Home correctness. The proxy and
  Browser DLP audit paths already fall back to direct DB inserts when Kafka is
  unavailable.
- ClickHouse, Qdrant, Jaeger, Redpanda Console, Grafana, and ASR are optional
  team/observability/advanced features and should not ship in the first
  layman-focused Home installer.

Recommended first release: **TITAN Home**, a native desktop app that bundles
Gateway + Dashboard + ML Engine + CockroachDB + Redis.

## Approaches considered

1. **Native launcher app wrapping Docker Compose** — GUI wrapper around the
   existing `docker-compose.yml`, trimmed to a lighter profile. Cheapest, but
   still requires the user to install Docker Desktop themselves.
2. **One-line install script + browser setup wizard** — keeps a terminal
   entry point but replaces manual `.env` editing with a web wizard. Lowest
   effort, but still touches a terminal once.
3. **Fully native app, no Docker dependency** — a real installer (.dmg/.exe)
   that bundles and supervises the actual service binaries directly, with no
   Docker requirement at all. Highest effort, but the only option that
   removes every piece of "technical stuff" from the experience.

**Decision: Option 3.** Within Option 3, two backend strategies were
considered — rewriting storage to lightweight embedded equivalents (SQLite,
in-process queue) versus bundling the real CockroachDB/Redis/Redpanda
binaries as managed subprocesses, since all three already ship as
self-contained binaries with no inherent Docker dependency.

**Decision: bundle the real binaries as subprocesses.** This avoids a
storage-layer rewrite and keeps behavior identical to the Docker edition; the
native app's job is installation and process supervision, not reimplementing
TITAN.

Revision after repo analysis: for the Home edition, "real binaries" means
CockroachDB and Redis. Redpanda can be omitted because durable audit has a
direct DB fallback when Kafka is absent. ClickHouse, Qdrant, Jaeger, Grafana,
and Redpanda Console should be out of scope for the first native installer.

For the ML engine specifically (prompt-injection/PII detection — torch,
transformers, easyocr, spaCy, ~1GB+ of Python dependencies), the choice was
between shipping a lightweight heuristic-only detector with models
downloaded on first use, versus bundling the full detection stack up front.

**Decision: bundle the full ML engine.** The installer will be large
(multi-GB) and per-OS/arch packaging is more work, but detection quality
matches the Docker edition exactly with no first-run download wait or
degraded-detection window.

Revision: keep this as the default "offline/full" installer goal, but also
plan a smaller bootstrap installer variant that downloads the ML/model pack
through the native setup wizard. The bootstrap path is likely the better public
download; the offline path is better for enterprise/private installs.

## Architecture

One native shell app acts as installer + process supervisor + first-run
wizard. Recommended shell: **Tauri** (Rust core + system webview) over
Electron, for a smaller footprint. It does not reimplement any TITAN logic —
it unpacks, launches, and manages the existing binaries as local background
processes.

```
Native App (Tauri)
 ├─ Installer: unpacks bundled binaries to an app-support directory on first launch
 ├─ Process Supervisor: starts/stops/health-checks each service
 │    ├─ CockroachDB (single static binary, single-node mode)
 │    ├─ Redis (single static binary)
 │    ├─ TITAN Gateway (existing Go binary, unchanged)
 │    ├─ TITAN Dashboard (Next standalone server + bundled Node runtime)
 │    └─ ML Engine (Python, packaged via PyInstaller/Nuitka/similar, unchanged code)
 ├─ First-Run Wizard: generates secrets, asks for one LLM provider API key
 └─ Tray/menu-bar icon: Start/Stop/Restart/Open Dashboard/View Logs/Quit
```

### Runtime topology

All services bind to localhost only.

| Service | Default local bind | Required | Notes |
|---|---:|---|---|
| Tauri app | n/a | yes | Installer, supervisor, tray/menu, wizard |
| Dashboard | `127.0.0.1:3000` or first free port | yes | Next standalone server; opened in app webview or browser |
| Gateway | `127.0.0.1:8080` or first free port | yes | OpenAI-compatible `/v1/*`, admin API, docs |
| ML Engine gRPC | `127.0.0.1:50051` | yes | Detection/PII engine; fail-open if unavailable, but Home should supervise it |
| ML Engine HTTP | `127.0.0.1:8001` | yes | Embeddings/config/report side-channel |
| CockroachDB | `127.0.0.1:26257` | yes | Hard dependency |
| Redis | `127.0.0.1:6379` | yes | Recommended bundled dependency |

### Home runtime environment

The supervisor writes a generated env file for Gateway and Dashboard rather
than asking the user to edit `.env` files.

Recommended Home settings:

```env
APP_ENV=production
LISTEN_ADDR=127.0.0.1:<gateway-port>
DASHBOARD_URL=http://127.0.0.1:<dashboard-port>
ADMIN_ALLOWED_ORIGINS=http://127.0.0.1:<dashboard-port>
DB_CONN_STRING=postgresql://root@127.0.0.1:<cockroach-port>/defaultdb?sslmode=disable
REDIS_ADDR=127.0.0.1:<redis-port>
ANALYZER_ADDR=127.0.0.1:<ml-grpc-port>
EMBEDDING_URL=http://127.0.0.1:<ml-http-port>/embed
GROQ_API_KEY=<provider-key-from-wizard>
ADMIN_TOKEN=<generated>
AUTH_SIGNING_SECRET=<generated>
DEFAULT_ADMIN_EMAIL=<user-email-from-wizard>
DEFAULT_ADMIN_PASSWORD=<user-password-from-wizard>
KAFKA_BROKERS=
CLICKHOUSE_URL=
QDRANT_URL=
ASR_URL=
OTEL_EXPORTER_OTLP_ENDPOINT=
```

Important implementation detail: `KAFKA_BROKERS=` must be an empty env value,
not omitted. If omitted, the gateway defaults to `localhost:9092` and attempts
Kafka startup. Empty means no producer/consumer and the direct DB audit fallback
is used.

### Home edition scope

Dropped from the Docker stack for this single-user "Home" edition:
**Redpanda, Redpanda Console, ClickHouse, Qdrant, Jaeger, Grafana, ASR**.

These are team-oriented observability/analytics/advanced execution surfaces, not
needed for a solo self-hoster. Audit events go straight to CockroachDB through
the gateway's existing direct fallback path.

Dashboard impact:

- Overview, Events, Audit Logs, Policies, API Keys, Settings, Billing catalog,
  Browser DLP, and core admin surfaces can work from Gateway/DB/Redis.
- Analytics views that rely on ClickHouse should show their existing fallback
  state.
- Semantic cache features are disabled unless Qdrant is included in a later
  installer profile.
- ASR/Sandboxes stay visible only as unavailable unless ASR is included later.

## Size Estimates

Current local repo signals:

- `ml_engine/` source/dependency area is already about `1.1 GB`.
- local HuggingFace cache is about `1.2 GB`.
- `dashboard/.next` is about `94 MB`; the full dev `node_modules` is much
  larger, but standalone output should be far smaller than dev dependencies.
- `gateway/` is small by comparison; the final gateway binary should be tens of
  MB, not GB.

Expected packaged sizes:

| Package profile | Installer/download size | Installed size | Notes |
|---|---:|---:|---|
| Bootstrap installer | `100-300 MB` | `5-8 GB` after model pack | Best public download; downloads ML/model pack during setup |
| Offline Home installer | `2-4 GB` | `5-8 GB` | No first-run model download; simplest offline behavior |
| Home + Qdrant | `2.3-4.5 GB` | `6-9 GB` | Adds semantic cache |
| Full Docker-equivalent native bundle | `4-8 GB` | `10-20+ GB` | Not recommended for layman Home |

Practical expectation for a Windows offline Home `.exe`: **about 3 GB**.
Installed footprint: **about 6 GB**.

## First-Run Wizard

Recommended screens:

1. **Welcome**
   - "TITAN will run locally on this computer."
   - Shows disk/RAM estimate before continuing.
2. **Provider key**
   - Provider selector: Groq first, OpenAI/compatible custom later.
   - API key input.
   - Optional "skip for now" allowed, but dashboard should clearly say live
     model calls will fail until a key is added.
3. **Admin account**
   - Email.
   - Password.
   - Generated strong defaults for machine secrets are hidden.
4. **Ports**
   - Auto-select free ports.
   - If default ports are taken, show plain-English copy and suggested ports.
5. **Install/start**
   - Unpack binaries if needed.
   - Start services in order.
   - Health-check every service.
6. **Done**
   - Open Dashboard.
   - Show local gateway base URL.
   - Show example SDK snippet.

Provider key validation:

- Do not block install on validation failure.
- If validation is attempted, send a tiny upstream test through the Gateway
  after Gateway + ML are healthy.
- Surface errors in plain English: "The provider rejected this key" vs "TITAN
  could not reach the provider."

## Process Supervision

Startup order:

1. CockroachDB single-node.
2. Redis.
3. ML Engine.
4. Gateway.
5. Dashboard.

Shutdown order:

1. Dashboard.
2. Gateway.
3. ML Engine.
4. Redis.
5. CockroachDB.

The Tauri supervisor should:

- keep process handles for each child;
- write per-service logs under app support;
- restart crashed non-DB services with bounded backoff;
- never auto-delete user data;
- detect stale processes from a previous crash;
- expose tray actions: Start, Stop, Restart, Open Dashboard, View Logs, Quit.

Health checks:

| Service | Check |
|---|---|
| CockroachDB | SQL ping through gateway readiness or direct TCP/SQL probe |
| Redis | `PING` or gateway readiness degraded/ok state |
| ML Engine | gRPC channel ready and/or HTTP `/health` if available |
| Gateway | `GET /health`, then `GET /ready` |
| Dashboard | `GET /login` |

## Data And Install Locations

Suggested app-support layout:

```text
TITAN/
  config/
    gateway.env
    dashboard.env
    supervisor.json
  bin/
    gateway/
    dashboard/
    ml_engine/
    cockroach/
    redis/
  data/
    cockroach/
    redis/
    models/
  logs/
    gateway.log
    dashboard.log
    ml_engine.log
    cockroach.log
    redis.log
```

macOS:

- `~/Library/Application Support/TITAN/`

Windows:

- `%LOCALAPPDATA%\TITAN\`

Uninstall must ask whether to remove local data. Default should be **keep data**.

## Error Handling

User-facing errors should avoid service jargon first, with details expandable.

Examples:

- Port conflict:
  - "TITAN could not use port 8080 because another app is already using it."
  - Button: "Use another port"
- CockroachDB failed:
  - "TITAN could not open its local database."
  - Detail includes log path.
- ML Engine failed:
  - "TITAN started, but AI detection is not running yet."
  - Button: "Restart detection engine"
- Provider key invalid:
  - "The model provider rejected this API key."
  - Button: "Edit key"

## Update Mechanism

Recommended for v1:

- Tauri updater for the shell app.
- Versioned bundled service packs:
  - Gateway version
  - Dashboard version
  - ML Engine/model pack version
  - CockroachDB/Redis binary versions
- Update flow:
  1. Stop services.
  2. Backup config.
  3. Replace binaries.
  4. Start CockroachDB.
  5. Start Gateway so embedded migrations run.
  6. Start remaining services.
  7. Run readiness checks.

Do not auto-update the local database binary across major versions until tested.

## Implementation Plan

### Phase 0 — Native runtime profile

- Add documented `home` env profile:
  - no Kafka;
  - no ClickHouse;
  - no Qdrant;
  - no ASR;
  - localhost-only binds;
  - generated secrets.
- Add a machine-readable service manifest consumed by the future Tauri app.
- Add a smoke test that runs Gateway with `KAFKA_BROKERS=`, `CLICKHOUSE_URL=`,
  and `QDRANT_URL=` and verifies audit rows still land in CockroachDB.

### Phase 1 — Package existing artifacts without GUI

- Build Gateway native binaries for macOS arm64/x64 and Windows x64.
- Build Dashboard standalone output and verify it runs with bundled Node.
- Package Redis and CockroachDB binaries.
- Create a local supervisor CLI prototype:
  - starts services;
  - writes env files;
  - health-checks;
  - stops services cleanly.

### Phase 2 — ML Engine packaging

- Try PyInstaller first, then Nuitka if PyInstaller becomes brittle with torch.
- Freeze Python version to 3.12 for wheel compatibility.
- Bundle spaCy model and HuggingFace model cache.
- Produce a repeatable `make package-ml-engine` or script.
- Measure:
  - packaged size;
  - cold start time;
  - RAM footprint;
  - first scan latency.

This is the highest-risk phase.

### Phase 3 — Tauri shell and wizard

- Build Tauri app with:
  - first-run wizard;
  - tray/menu;
  - process supervisor;
  - log viewer;
  - settings editor for provider key and ports.
- The webview can either load the local dashboard directly or expose a small
  native status UI with "Open Dashboard" in the system browser. For v1, system
  browser is simpler and more robust.

### Phase 4 — Installer packaging

- macOS first:
  - signed `.dmg`;
  - notarization;
  - Apple Silicon first, Intel second if needed.
- Windows second:
  - signed `.exe` or `.msi`;
  - Windows service/tray behavior decision;
  - Defender false-positive checks.

### Phase 5 — QA matrix

Minimum manual QA:

- fresh macOS install;
- reinstall over existing data;
- uninstall while keeping data;
- uninstall and remove data;
- port conflict;
- invalid provider key;
- no internet after install;
- ML engine crash/restart;
- database restart;
- laptop sleep/wake.

Automated QA:

- service supervisor unit tests;
- app-support path tests;
- smoke test against local packaged services;
- Playwright dashboard smoke once supervisor reports ready.

## Open Questions

- Platform order: recommendation is macOS Apple Silicon first, then Windows x64.
- Bootstrap vs offline public installer: recommendation is bootstrap public,
  offline full installer as alternate download.
- Exact model set to bundle for Home: use the current Docker-equivalent set for
  parity, then optimize after size/RAM measurements.
- Whether to include Qdrant in a "Home Pro" profile later for semantic cache.
- Whether local Home should expose Browser DLP setup/install inside the native
  app.

## Next Step

Do **Phase 0** first. It is the proof that the current repo can run in a
native-friendly Home profile before spending time on Tauri packaging.

Definition of done for Phase 0:

- Gateway starts with `KAFKA_BROKERS=`, `CLICKHOUSE_URL=`, `QDRANT_URL=`,
  `ASR_URL=`.
- Dashboard loads and core tabs do not crash.
- A test request through `/v1/chat/completions` writes an audit row directly to
  CockroachDB.
- A browser-DLP report writes an audit row directly to CockroachDB.
- A single command starts the Home profile without Docker.
