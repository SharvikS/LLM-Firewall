# Codebase Audit - 2026-07-02

## Scope

This pass reviewed the tracked repository structure and the main runnable
surfaces:

- `gateway/` Go data plane, admin API, store, enterprise build tags, and tests.
- `dashboard/` Next.js control plane, proxy/auth routes, build, lint, and e2e.
- `landing/` Next.js marketing and activation surface.
- `browser-extension/` MV3 React/Vite extension.
- `ml_engine/` Python analyzer service and tests.
- `asr/` FastAPI Agent Security Runtime source and test setup.
- `sdk/node`, `sdk/python`, `helm/`, scripts, and high-signal docs.

## Cleanup Applied

- Removed tracked generated/runtime artifacts:
  - `gateway/bin/server` - local Mach-O build artifact, about 17 MB.
  - `loadtest/loadtest` - local Mach-O build artifact, about 8 MB.
  - `gateway/dump.rdb` - local Redis runtime dump.
- Removed stale duplicate migration copies under `gateway/sql/`.
  - The live source of truth is the embedded migration set in
    `gateway/internal/store/sql/`.
  - The deleted copies were already behind the embedded migrations.
- Updated `.gitignore` so these artifacts do not return:
  - `gateway/bin/`
  - `loadtest/loadtest`
  - `dump.rdb`
- Fixed dashboard runtime configuration drift:
  - Helm dashboard deployment now sets `GATEWAY_URL`, matching
    `dashboard/src/lib/gateway.ts`.
  - Removed stale `NEXT_PUBLIC_GATEWAY_URL` wording from installer docs and the
    SSO start-route comment.
- Enabled TypeScript unused-symbol gates in both Next.js apps:
  - `dashboard/tsconfig.json`
  - `landing/tsconfig.json`
- Added `asr/requirements-dev.txt` so ASR test dependencies are explicit.

## Verification Run

Passed:

- `cd gateway && go test ./...`
- `cd gateway && go vet ./...`
- `cd gateway && go test -tags enterprise ./...`
- `cd loadtest && go test ./...`
- `cd dashboard && npm run test:home-profile`
- `cd dashboard && npm run lint`
- `cd dashboard && npm run build`
- `cd dashboard && npm run test:e2e`
- `cd landing && npm run lint`
- `cd landing && npm run build`
- `cd browser-extension && npm run lint`
- `cd browser-extension && npm test`
- `cd browser-extension && npm run build`
- `cd ml_engine && venv/bin/python -m pytest tests -q`
- `cd ml_engine && venv/bin/python -m compileall -q analyzer tests`
- `cd asr && venv/bin/python -m compileall -q api core tests`
- `python3 -m compileall -q sdk/python/titan_firewall scripts`
- `cd sdk/node && node --check index.js`
- `git diff --check`

ML engine result: `71 passed, 3 skipped`. Warnings are dependency/runtime
warnings, mostly Python 3.14 deprecations in Torch/JIT and tokenizer libraries.

Not run:

- ASR pytest suite: the existing `asr/venv` does not have `pytest` installed.
  This audit adds `asr/requirements-dev.txt`; install it with
  `cd asr && venv/bin/pip install -r requirements-dev.txt` before running
  `venv/bin/python -m pytest tests -q`.
- Helm lint/template: `helm` is not installed locally.
- Optional analyzers: `staticcheck`, `golangci-lint`, and `ruff` are not
  installed locally.

## Structural Findings

### Good State

- The current cleanup diff removes the large local build binaries and Redis
  runtime dump found during the audit.
- There are no tracked `node_modules`, `.next`, `dist`, `__pycache__`,
  `.pytest_cache`, or `.home-dev-data` artifacts.
- Gateway default and enterprise test suites pass.
- Dashboard and landing compile with strict TypeScript plus unused-symbol
  checks.
- Browser extension lint, unit tests, and production build pass.
- ML engine tests pass through the existing venv.

### Follow-up Recommendations

1. Split large files when making feature changes.
   - `gateway/internal/proxy/proxy.go` is over 1,000 lines.
   - `dashboard/src/app/components/tabs/RemainingTabs.tsx` is over 900 lines.
   - `gateway/internal/api/admin.go` is about 800 lines.
   These are not broken, but future edits should carve out focused handlers,
   tab components, or helper packages instead of adding more surface area.

2. Add formal Python linting.
   The Python services compile and tests pass where dependencies exist, but
   there is no repo-level Ruff configuration or script. Add Ruff once the team
   agrees on line length and rule set.

3. Add a Helm verification path.
   The chart now matches the dashboard env contract, but local chart rendering
   could not be verified because Helm is missing. CI should keep `helm lint` and
   `helm template` as release gates.

4. Install and run ASR dev dependencies in CI.
   ASR has tests but its local runtime requirements do not include pytest. The
   new `asr/requirements-dev.txt` makes that explicit.

5. Keep generated assets clearly intentional.
   `gateway/plugins/confidential_terms.wasm` remains tracked intentionally as a
   sample WASM plugin referenced by docs and Docker Compose.
