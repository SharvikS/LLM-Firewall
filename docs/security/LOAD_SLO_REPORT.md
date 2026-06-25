# Load Test and SLO Evidence

Last updated: 2026-06-25

## Evidence Status

No fresh load test was run in this pass because Docker and the full local stack
were intentionally not started. This file is therefore a release-readiness
template and evidence checklist, not a claim that current SLOs are proven.

The repository already includes a stdlib-only load harness at `loadtest/`. The
new `release-gates` CI workflow compiles that harness so it cannot silently
break. A real SLO report still requires a live gateway, ML engine, Redis,
CockroachDB, Kafka/Redpanda, Qdrant, and upstream/fake upstream target.

## Target SLOs

| Metric | Enterprise target |
|---|---:|
| Gateway p95 overhead, excluding provider latency | < 25 ms |
| Gateway p99 overhead, excluding provider latency | < 100 ms |
| Sustained audit persistence lag | < 60 seconds |
| SIEM delivery lag for high-risk events | < 10 seconds |
| Injection block correctness during load | 100% for harness injection class |
| Transport error rate during steady-state test | <= 1% |
| Overall harness failure threshold | <= 5% error rate and zero injection slips |

## Required Test Matrix

| Scenario | Command |
|---|---|
| Smoke load | `cd loadtest && go run . -n 200 -c 10` |
| Baseline mixed traffic | `cd loadtest && go run . -d 5m -c 50` |
| Injection-heavy | `cd loadtest && go run . -mix "benign=0,injection=100,pii=0" -n 1000 -c 50` |
| PII-heavy | `cd loadtest && go run . -mix "benign=20,injection=0,pii=80" -n 1000 -c 50` |
| Soak | `cd loadtest && go run . -d 30m -c 100` |

## Evidence to Attach After Running

- Load-test stdout for each scenario.
- Gateway `/metrics` snapshot before and after each run.
- Audit row counts before and after each run.
- Kafka/Redpanda consumer lag during the run.
- SIEM receiver timestamps for at least one high-risk event.
- Dashboard screenshots for Events, Audit Logs, Analytics, and Coverage.
- Gateway logs covering the run window.

## Current Release Position

TITAN is ready to demonstrate load-test capability and ready for a controlled
pilot performance run. It should not claim published production SLO attainment
until this report is populated with measured results from a production-like
environment.

