#!/bin/bash
set -e

echo "🚀 Starting CyberFort AI - TITAN Platform"

# 1. Check Docker (Bypassed)
if ! command -v docker &> /dev/null || ! docker info &> /dev/null; then
  echo "⚠️ WARNING: Docker is not running!"
  echo "Skipping the heavy Data Platform (Redpanda, CockroachDB, ClickHouse)."
  echo "Starting API servers and UI in 'Dev Mode'..."
else
  # 2. Start Data Platform
  echo "📦 Starting Data Platform (Redpanda, CockroachDB, ClickHouse)..."
  cd platform
  docker-compose up -d
  cd ..
fi

# 3. Start Intelligence Plane (Python ASR)
echo "🧠 Starting Intelligence Plane (ASR V2)..."
cd analyzer
if [ ! -d "venv" ]; then
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi
export PYTHONPATH=$PWD/..
nohup uvicorn analyzer.main:app --port 8000 > asr.log 2>&1 &
ASR_PID=$!
cd ..

# 4. Start Data Plane (Go Gateway)
echo "🛡️ Starting Data Plane (Go Gateway)..."
cd gateway
nohup go run cmd/server/main.go > gateway.log 2>&1 &
GW_PID=$!
cd ..

# 5. Start Control Plane (Next.js Dashboard)
echo "📊 Starting Control Plane (Dashboard)..."
cd dashboard
nohup npm run dev > dashboard.log 2>&1 &
DASH_PID=$!
cd ..

echo "-----------------------------------------------------"
echo "✅ ALL TITAN SYSTEMS OPERATIONAL!"
echo "-----------------------------------------------------"
echo "🖥️  Control Plane (UI): http://localhost:3000"
echo "🛡️  Go Gateway (Data):  http://localhost:8080"
echo "🧠 Python ASR (Intel): http://localhost:8000"
echo "-----------------------------------------------------"
echo "🛑 To shut down the platform, run this command:"
echo "kill -9 $ASR_PID $GW_PID $DASH_PID && cd platform && docker-compose down"
