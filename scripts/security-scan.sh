#!/usr/bin/env bash
# Dependency / CVE scan across all three components. Writes a consolidated JSON
# report (docs/security/scan-report.json) the dashboard Vulnerabilities tab reads,
# and prints a human summary. Exits non-zero if any scanner reports a finding so
# it can gate CI.
#
#   ./scripts/security-scan.sh
#
# Tools (install on demand):
#   Go     — govulncheck  (go install golang.org/x/vuln/cmd/govulncheck@latest)
#   Python — pip-audit    (pip install pip-audit)
#   Node   — npm audit    (bundled with npm)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/docs/security"
mkdir -p "$OUT_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PYBIN="$ROOT/ml_engine/venv/Scripts/python.exe"
[ -x "$PYBIN" ] || PYBIN="python"

echo "── Go (gateway) — govulncheck ───────────────────────────────"
if command -v govulncheck >/dev/null 2>&1; then
  (cd "$ROOT/gateway" && govulncheck ./... > "$TMP/go.txt" 2>&1) || true
  grep -iE "affected by|no vulnerabilities" "$TMP/go.txt" | tail -1
else
  echo "not-installed" > "$TMP/go.txt"; echo "  govulncheck not installed — skipped"
fi

echo "── Python (ml_engine) — pip-audit ───────────────────────────"
if "$PYBIN" -m pip show pip-audit >/dev/null 2>&1; then
  "$PYBIN" -m pip_audit -f json > "$TMP/py.json" 2>/dev/null || true
else
  echo "not-installed" > "$TMP/py.json"; echo "  pip-audit not installed — skipped"
fi

echo "── Node (dashboard) — npm audit ─────────────────────────────"
if command -v npm >/dev/null 2>&1; then
  (cd "$ROOT/dashboard" && npm audit --json > "$TMP/js.json" 2>/dev/null) || true
else
  echo "not-installed" > "$TMP/js.json"; echo "  npm not installed — skipped"
fi

# Robust parsing + report generation in Python (grep on these JSON/text formats
# is fragile — govulncheck streams the whole OSV DB, npm nests counts by severity).
"$PYBIN" "$ROOT/scripts/scan_report.py" \
  --go "$TMP/go.txt" --py "$TMP/py.json" --js "$TMP/js.json" \
  --out "$OUT_DIR/scan-report.json" \
  --timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
rc=$?

echo "──────────────────────────────────────────────────────────────"
echo "wrote $OUT_DIR/scan-report.json"
exit $rc
