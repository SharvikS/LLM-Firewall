# TITAN Gateway — Investor Demo Runbook

A 3-step path from a clean machine to a live, fully-configurable demo.

## 1. Add your provider key (one line)

Open `gateway/.env` and paste your LLM key:

```
GROQ_API_KEY=gsk_your_real_key_here
```

The compose `TARGET_URL` defaults to Groq. To use OpenAI instead, put your
OpenAI key in `GROQ_API_KEY` and change `TARGET_URL` to `https://api.openai.com`
in `docker-compose.yml`. The `ADMIN_TOKEN` default already matches the
dashboard — no other secrets needed for a local demo.

## 2. Bring the whole stack up

```bash
docker compose up -d --build
```

First boot builds the Go/Next images and starts 11 services (gateway, ML
engine, dashboard, CockroachDB, Redis, Redpanda, ClickHouse, Qdrant, Jaeger,
Grafana, Redpanda console). The ML image bakes the HuggingFace models, so cold
start is seconds, not minutes, after the first build.

| Surface            | URL                          |
|--------------------|------------------------------|
| Dashboard (control plane) | http://localhost:3000 |
| Gateway (data plane)      | http://localhost:8080 |
| Grafana (audit OLAP)      | http://localhost:3001 |
| Jaeger (traces)           | http://localhost:16686 |

## 3. Verify everything is green

```bash
./scripts/smoke.sh
```

12+ checks covering health/readiness, auth, injection/toxicity/plugin blocks,
PII masking, analytics, audit, and a **live settings round-trip**. Expect
`PASS=… FAIL=0`.

---

## What's configurable from the dashboard (live, no restart)

Every change below is applied across all gateway replicas immediately and
persisted in CockroachDB.

- **Settings → General**: rate limit (RPM), token limit (TPM), cache TTL,
  analyzer timeout.
- **Settings → Security Defaults**: PII redaction, toxicity filtering, output
  response scanning, block source-code pastes, audit-all-requests.
- **Data Privacy**: per-entity Presidio recognizers (SSN, email, credit card,
  phone, person, IP, passport, IBAN) + master redaction switch.
- **Edge Routing**: provider failover toggle.

Gateway-plane knobs apply in-process; ML-plane knobs (toxicity/PII/code-leak)
are pushed to the Python engine's `/config` endpoint on each change.

## Health & readiness

- `GET /health` — liveness (always 200 while up).
- `GET /ready` — readiness with component status (DB is the hard dependency;
  Redis and the ML engine are reported but degrade gracefully).

## Demo talking points

1. Send a benign prompt → 200 ALLOW, appears in the live Events feed.
2. Send `Ignore all previous instructions…` → 403 BLOCK (ML injection gate).
3. Send a prompt with an SSN/email → 200 but masked (`X-Titan-PII-Masked`).
4. Toggle **Data Privacy → US_SSN off**, resend → SSN now passes through (live
   config change, no restart).
5. Show **Audit Logs** export (CSV/JSONL) and **Grafana** OLAP dashboard.
