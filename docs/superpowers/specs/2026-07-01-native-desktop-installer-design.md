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
   - Asks what brought them here, in plain language, with two options (not
     mutually exclusive, both may be selected): "Protect my ChatGPT/Claude
     browsing" and "Protect an app I'm building or running." Answer only
     changes which path is emphasized on the Done screen — every service
     still installs and runs either way, since the extension needs the same
     local ML engine regardless.
2. **Provider key**
   - Provider selector: Groq first, OpenAI/compatible custom later.
   - API key input, with a collapsed "How do I get one?" per provider
     (direct signup link + one-line explanation of what an API key is).
   - Optional "skip for now" allowed. Copy differs by the Welcome answer:
     developers see "live model calls through the proxy will fail until a
     key is added"; browser-only users see "not required for browser
     protection — only needed if you also want to route your own app's
     calls."
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
   - If "browser protection" was selected (or both): lead with installing/
     enabling the browser extension — no app or API base URL shown first.
   - If "protect my app" was selected (or both): show the local Gateway
     base URL and an example SDK snippet.
   - Both blocks are always present; order follows the Welcome answer so
     neither audience is treated as the assumed default.

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
- Bundle EasyOCR's model weights and wire `model_storage_directory`/
  `download_enabled=False` through an env var (see Gap Resolution #2) so the
  Home build never phones home for OCR models.
- Build natively per architecture — macOS arm64, macOS x64, Windows x64 — as
  three separate CI runners. Do not attempt to cross-compile/cross-package
  torch (see Gap Resolution #4).
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
- **Go/no-go spike before any other Windows work** (see Gap Resolution #3):
  verify a native `cockroach` Windows binary actually runs a usable
  single-node server and passes Gateway migrations. If it doesn't, resolve
  the fallback (WSL2, alternate embedded DB, or macOS-only v1) before
  proceeding.
- Windows second (only after the spike passes):
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

- **Pending spike:** whether CockroachDB is viable on native Windows — see
  Gap Resolution #3; gates the Windows release, not the macOS one.
- Bootstrap vs offline public installer: recommendation is bootstrap public,
  offline full installer as alternate download.
- Exact model set to bundle for Home: use the current Docker-equivalent set for
  parity, then optimize after size/RAM measurements.
- Whether to include Qdrant in a "Home Pro" profile later for semantic cache.
- Whether local Home should expose Browser DLP setup/install inside the native
  app.

## Gap Resolutions (review pass, 2026-07-01)

A verification pass against the actual codebase (not just the plan) surfaced
six gaps. Each is resolved below; one requires a scope decision (see the
Target User Decision at the end of this section).

### 1. Dynamic port selection vs. the dashboard build — false alarm, confirmed safe

Initial concern: `NEXT_PUBLIC_GATEWAY_URL` (`dashboard/src/lib/gateway.ts:7`)
looked like a build-time-baked constant, which would break the wizard's
"auto-pick a free port for the Gateway" step for a prebuilt standalone
dashboard bundle.

Verified: every importer of `GATEWAY` is a server-side `app/api/**/route.ts`
handler (checked via grep across `dashboard/src`) — none are client
components. Next.js only inlines `NEXT_PUBLIC_*` values into code that ships
to the browser; server-side route handlers read `process.env` normally, at
process start. Since the wizard writes the env file *before* launching the
Dashboard's Node process, any chosen Gateway port is picked up correctly with
no rebuild and no code change required.

Action: add one regression test in Phase 0 that starts the packaged
dashboard with a non-default `NEXT_PUBLIC_GATEWAY_URL` and confirms an
`/api/gateway/*` route reaches the right port. This guards against a future
change accidentally introducing a client-side import of `GATEWAY` and
silently reintroducing the bug.

### 2. EasyOCR breaks the offline promise

`ml_engine/analyzer/extract.py`'s `easyocr.Reader(langs, gpu=False, ...)`
call uses EasyOCR's defaults: `download_enabled=True`, default
`model_storage_directory`. It downloads its detection/recognition weights
from the internet on first OCR use — separate from the spaCy/HuggingFace
caches already planned for bundling.

Plan:
- During ML-engine packaging, pre-download EasyOCR's model weights (e.g.
  `craft_mlt_25k.pth`, `english_g2.pth`) into a bundled directory.
- Change the `easyocr.Reader(...)` call site to accept
  `model_storage_directory` and `download_enabled` from an env var (e.g.
  `EASYOCR_MODEL_DIR`, default empty = current behavior), so Docker/Enterprise
  installs are unaffected and the Home installer points at the bundled path
  with downloads disabled.
- Add ~200-300MB to the size estimate for OCR weights.
- Add a Phase 2 smoke test: run an OCR scan with network access disabled and
  confirm no download attempt occurs.

### 3. CockroachDB on native Windows is unverified

Nothing in this repo confirms whether CockroachDB's Windows binary is a
genuinely production-usable native server, or whether Windows realistically
needs Docker/WSL for it — this is an external fact this review can't check
from the codebase.

Plan: turn this into an explicit **go/no-go spike at the start of Phase 4**,
not a discovery made partway through packaging:
- Install the official `cockroach` Windows artifact on a clean Windows VM,
  run `cockroach start-single-node --insecure`, confirm the Gateway can
  connect and run its embedded migrations against it.
- If it fails or isn't viable for real use: ranked fallbacks are (a) bundle
  WSL2 with a Linux `cockroach` binary invoked through it — still not Docker,
  but another virtualization layer to auto-install; (b) swap to an embeddable
  Postgres-compatible database on Windows only, meaning storage differs by
  OS — larger scope than currently planned; (c) ship macOS-only for v1 and
  revisit Windows once (a) or (b) is scoped.
- This spike gates the rest of Phase 4 for Windows; it does not block the
  macOS release.

### 4. Per-architecture ML engine packaging not called out

Torch wheels differ per OS/arch (and CPU vs. GPU); Phase 4 already plans
separate macOS Apple Silicon/Intel and Windows installers, but Phase 2 didn't
say the PyInstaller/Nuitka build itself must happen natively per
architecture — torch cannot be reliably cross-compiled/cross-packaged.

Plan: add to Phase 2 explicitly — CI matrix with three native runners (macOS
arm64, macOS x64, Windows x64), each producing its own packaged ML engine
artifact. No cross-compilation attempted.

### 5. Provider-key onboarding has no explainer

The wizard's "Provider key" screen asks for an API key but never explains
what one is or how to get one — a real gap if the target user doesn't
already have a provider account.

Plan: add an inline, collapsed "How do I get one?" per provider (direct
signup link + one-line explanation) on that screen. Key remains optional/
skippable as already planned, but the copy makes the skip consequence and
the signup path both clear.

### 6. Strategic scope — decided: one installer serves every audience

Goal (per project direction): reach as many users as possible, rather than
picking one persona and deferring the rest.

Initial concern: TITAN's core value is being a proxy in front of *your own
app's* LLM calls, so a user with no app of their own would seemingly have
nothing to point at `127.0.0.1:8080`.

Checked against the code and confirmed this concern doesn't force a scope
split: `browser-extension/src/lib/config.js:8` shows the extension calls
`http://localhost:8001/scan` (the ML engine) **directly**, in real time, for
its core block/redact DLP behavior on ChatGPT/Claude/Gemini/Perplexity — not
just for after-the-fact audit reporting. That means a true non-technical
consumer, who never touches the Gateway's `/v1/*` proxy at all, still gets
full value from the same native install: it's what powers their browser
extension's live protection.

**Decision: one installer, no persona split.** The native app is the single
onboarding path for everyone:
- A developer/small-business user additionally gets the SDK/`base_url`
  snippet on the "Done" screen to route their own app.
- A pure consumer's "Done" screen instead leads straight into installing/
  enabling the browser extension — no app of their own required.

Action: the First-Run Wizard's final "Done" screen (see below) presents
both paths explicitly, and neither is treated as more "default" than the
other — the wizard asks up front which the user wants (or shows both) so
first-time copy doesn't assume a developer audience.

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
