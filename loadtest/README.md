# TITAN Gateway — load / stress test harness

A self-contained, stdlib-only Go program that hammers the gateway's
`POST /v1/chat/completions` endpoint with a configurable blend of **benign**,
**prompt-injection**, and **PII** traffic, then reports throughput, latency
percentiles, and whether the security controls held under load.

It is its own Go module (`titan/loadtest`) so it never interferes with the
gateway build. No third-party dependencies.

## Build

```bash
cd loadtest
go build -o titan-loadtest .
# or just run it directly:
go run . -n 200 -c 10
```

## Prerequisites

Bring the stack up first (see `../DEMO.md`):

```bash
docker compose up -d --build   # from the repo root
curl -s localhost:8080/health  # should be 200 before you load-test
```

The default key is the seeded dev key `titan_dev_localkeyfortesting1234`.

## Flags

| Flag     | Default                              | Meaning |
|----------|--------------------------------------|---------|
| `-url`   | `http://localhost:8080`              | Gateway base URL (path is appended). |
| `-key`   | `titan_dev_localkeyfortesting1234`   | Bearer API key. |
| `-c`     | `20`                                 | Concurrency — number of worker goroutines. |
| `-n`     | `1000`                               | Total requests (ignored when `-d` is set). |
| `-d`     | _unset_                              | Run for a duration, e.g. `30s`, `2m`. **Takes precedence over `-n`.** |
| `-mix`   | `benign=70,injection=20,pii=10`      | Traffic blend as `name=pct,...` (percentages). |
| `-model` | `llama-3.1-8b-instant`               | Model name sent in the request body. |

## Example invocations

```bash
# Smoke — quick sanity load
go run . -n 200 -c 10

# Soak — sustained load for one minute at higher concurrency
go run . -d 60s -c 50

# Injection-heavy — pure attack traffic; verifies the detector holds up
go run . -mix "benign=0,injection=100,pii=0" -n 500 -c 25

# Custom target / key
go run . -url http://staging.internal:8080 -key titan_live_xxx -d 30s -c 40
```

Press **Ctrl-C** at any time for a clean shutdown — in-flight requests are
cancelled via context and a partial report is still printed.

## What it checks

Each request is tagged with its expected outcome and the result is scored:

- **benign** → expect `2xx`
- **pii** → expect `2xx` (the gateway masks PII in-flight, the request still succeeds)
- **injection** → expect `403` (blocked by the ML engine)

## Output

A live progress line (requests done, instantaneous & average RPS) updates every
second, followed by a final report containing:

- total requests, wall time, throughput (req/s)
- status-code breakdown (ok / blocked / unauthorized / error) + transport errors
- latency p50 / p90 / p99 / max
- observed injection block-rate vs. the configured mix share
- per-class correctness verdict (PASS/FAIL)
- overall error rate

## Exit codes

| Code | Meaning |
|------|---------|
| `0`  | Healthy — error rate ≤ 5% and **all** injections were blocked. |
| `1`  | Regression — error rate > 5% **or** one or more injections slipped through (a real security signal). |
| `2`  | Bad invocation (e.g. malformed `-mix`). |

This makes the harness safe to wire into CI as a gate.
