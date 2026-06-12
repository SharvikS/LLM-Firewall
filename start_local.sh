#!/bin/bash
set -e

echo "🚀 Starting TITAN Gateway — Zero-Trust LLM Firewall"

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── 1. Infrastructure (Docker) ────────────────────────────────────────────────
if ! command -v docker &> /dev/null || ! docker info &> /dev/null 2>&1; then
  echo "⚠️  WARNING: Docker is not running."
  echo "    CockroachDB, Redis, Redpanda, ClickHouse, Qdrant, and Jaeger must be started manually."
else
  echo "📦 Starting infrastructure (Redis, CockroachDB, Redpanda, ClickHouse, Qdrant, Jaeger)..."
  cd "$ROOT"
  docker compose up -d redis cockroachdb redpanda clickhouse qdrant jaeger
  echo "    Waiting for infrastructure to become healthy (~15s)..."
  sleep 15
fi

# ── 2. ML Engine (Python gRPC, port 50051) ────────────────────────────────────
echo "🧠 Starting ML Engine (gRPC analyzer)..."
cd "$ROOT/ml_engine"
if [ ! -d "venv" ]; then
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt -q
else
    source venv/bin/activate
fi
export GRPC_PORT=50051
export OTEL_EXPORTER_OTLP_ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4318}"
export OTEL_SERVICE_NAME=titan-ml-engine
nohup python -m analyzer.server > "$ROOT/ml_engine/ml_engine.log" 2>&1 &
ML_PID=$!
echo "    ML Engine started (PID $ML_PID) — log: ml_engine/ml_engine.log"

# ── 3. Go Gateway (port 8080) ─────────────────────────────────────────────────
echo "🛡️  Starting Go Gateway..."
cd "$ROOT/gateway"
export CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://localhost:8123}"
export CLICKHOUSE_DATABASE="${CLICKHOUSE_DATABASE:-titan}"
export QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
export OTEL_SERVICE_NAME=titan-gateway
nohup go run cmd/server/main.go > "$ROOT/gateway/gateway.log" 2>&1 &
GW_PID=$!
echo "    Gateway started (PID $GW_PID) — log: gateway/gateway.log"

# ── 4. Next.js Dashboard (port 3000) ─────────────────────────────────────────
echo "📊 Starting Next.js Dashboard..."
cd "$ROOT/dashboard"
nohup npm run dev > "$ROOT/dashboard/dashboard.log" 2>&1 &
DASH_PID=$!
echo "    Dashboard started (PID $DASH_PID) — log: dashboard/dashboard.log"

cd "$ROOT"

echo ""
echo "──────────────────────────────────────────────────────"
echo "✅  TITAN Gateway stack is starting up"
echo "──────────────────────────────────────────────────────"
echo "  Control Plane (UI):  http://localhost:3000"
echo "  Go Gateway (Data):   http://localhost:8080"
echo "  ML Engine (gRPC):    localhost:50051"
echo "  Jaeger Traces:       http://localhost:16686"
echo "──────────────────────────────────────────────────────"
echo "  Health check:  curl http://localhost:8080/health"
echo ""
echo "🛑 To stop:"
echo "   kill $ML_PID $GW_PID $DASH_PID"
echo "   docker compose stop redis cockroachdb redpanda clickhouse qdrant jaeger"
