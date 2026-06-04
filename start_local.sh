#!/bin/bash
set -e

echo "🚀 Starting CyberFort AI - TITAN Platform"

# 1. Check Docker
if ! command -v docker &> /dev/null || ! docker info &> /dev/null; then
  echo "❌ ERROR: Docker is not running!"
  echo "The Titan backend (CockroachDB, Redpanda, ClickHouse) requires Docker."
  echo "Please start Docker Desktop and run this script again."
  exit 1
fi

# 2. Start Data Platform
echo "📦 Starting Data Platform (Redpanda, CockroachDB, ClickHouse)..."
cd platform
docker-compose up -d
cd ..

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
