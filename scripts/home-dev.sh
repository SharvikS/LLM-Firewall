#!/usr/bin/env bash
set -euo pipefail

# Starts the TITAN "Home" profile (no Docker, no Kafka/ClickHouse/Qdrant/ASR)
# directly from source, for developers proving out the Home runtime profile
# ahead of the native installer (see docs/superpowers/specs/2026-07-01-native-desktop-installer-design.md).
#
# Prerequisites (not installed by this script):
#   - cockroach and redis-server on PATH (e.g. `brew install cockroachdb/tap/cockroach redis`)
#   - Go 1.26+, a Python virtualenv at ml_engine/venv with ml_engine/requirements.txt
#     installed (see ml_engine/README or run `python3 -m venv venv && venv/bin/pip
#     install -r requirements.txt` inside ml_engine/), Node 20+ with dashboard/node_modules
#     already installed.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="$ROOT/.home-dev-data"
PIDS=()

# Each service is launched as `( cd ... && cmd ) &`, so the PID we capture is
# the subshell, not the real service — and `go run`/`npm run dev` fork further
# child processes of their own (the compiled binary, the `next dev` node
# process). macOS has no `setsid`, so we can't rely on process groups; instead
# recursively signal the whole descendant tree of each tracked PID so nothing
# is left orphaned on exit.
kill_tree() {
  local pid="$1" sig="$2"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child" "$sig"
  done
  kill "-$sig" "$pid" 2>/dev/null || true
}

cleanup() {
  echo ""
  echo "Stopping Home profile..."
  for pid in "${PIDS[@]}"; do
    kill_tree "$pid" TERM
  done
  sleep 2
  for pid in "${PIDS[@]}"; do
    kill_tree "$pid" KILL
  done
  for pid in "${PIDS[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

command -v cockroach >/dev/null 2>&1 || { echo "ERROR: cockroach not found on PATH." >&2; exit 1; }
command -v redis-server >/dev/null 2>&1 || { echo "ERROR: redis-server not found on PATH." >&2; exit 1; }

ML_ENGINE_PYTHON="$ROOT/ml_engine/venv/bin/python"
if [ ! -x "$ML_ENGINE_PYTHON" ]; then
  echo "ERROR: $ML_ENGINE_PYTHON not found. Create it with:" >&2
  echo "  cd ml_engine && python3 -m venv venv && venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

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

# Timeout defaults to 30s; Gateway and Dashboard get longer because their
# first run pays for `go run` compiling a fresh binary / `next dev` cold
# compile on top of 16 sequential CockroachDB migrations, which measured
# ~40s+ in practice — 30s was too tight and caused the script to give up
# and tear down a Gateway that was still migrating.
wait_for_tcp() {
  local host="$1" port="$2" label="$3" timeout="${4:-30}" elapsed=0
  until (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; do
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge "$timeout" ]; then
      echo "ERROR: $label did not come up on $host:$port after ${timeout}s" >&2
      exit 1
    fi
    sleep 1
  done
  exec 3>&- 3<&- 2>/dev/null || true
  echo "  $label is up on $host:$port"
}

wait_for_tcp 127.0.0.1 26257 "CockroachDB"
wait_for_tcp 127.0.0.1 6379 "Redis"

echo "Starting ML Engine..."
( cd "$ROOT/ml_engine" && GRPC_PORT=50051 EMBED_PORT=8001 "$ML_ENGINE_PYTHON" -m analyzer.server ) \
  > "$DATA_DIR/ml_engine.log" 2>&1 &
PIDS+=($!)

wait_for_tcp 127.0.0.1 50051 "ML Engine gRPC" 60

echo "Starting Gateway..."
( cd "$ROOT/gateway" && set -a && source .env.home.example && set +a && go run ./cmd/server ) \
  > "$DATA_DIR/gateway.log" 2>&1 &
PIDS+=($!)

wait_for_tcp 127.0.0.1 8080 "Gateway" 120

echo "Starting Dashboard..."
( cd "$ROOT/dashboard" && set -a && source .env.home.example && set +a && npm run dev ) \
  > "$DATA_DIR/dashboard.log" 2>&1 &
PIDS+=($!)

wait_for_tcp 127.0.0.1 3000 "Dashboard" 90

echo ""
echo "Home profile is up:"
echo "  Dashboard: http://127.0.0.1:3000"
echo "  Gateway:   http://127.0.0.1:8080"
echo "  Logs:      $DATA_DIR/*.log"
echo ""
echo "Press Ctrl+C to stop everything."
wait
