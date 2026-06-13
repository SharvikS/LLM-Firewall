# TITAN Gateway — Grafana

Pre-built Grafana dashboards visualizing the audit data that the gateway
streams into ClickHouse (`titan.audit_events`). Everything is provisioned on
startup — no manual datasource setup or dashboard import is required.

## Access

| | |
|---|---|
| URL | http://localhost:3001 |
| Anonymous | Viewer role enabled — the dashboards load with no login (for demos) |
| Admin login | `admin` / `titan-admin` (needed to edit panels or save changes) |

Start it with the rest of the stack:

```bash
docker compose up -d grafana
```

Grafana depends on a healthy `clickhouse` service. On first boot it installs
the `grafana-clickhouse-datasource` plugin, so allow a few extra seconds.

## How it's wired

- **Datasource** — `platform/grafana/provisioning/datasources/clickhouse.yaml`
  provisions the ClickHouse datasource (uid `titan-clickhouse`) against the
  `clickhouse` compose service over the **native protocol on port 9000**,
  database `titan`, user `default` (no password). It is the default datasource.
- **Dashboard provider** — `platform/grafana/provisioning/dashboards/titan.yaml`
  loads every dashboard JSON from `/var/lib/grafana/dashboards` into a `TITAN`
  folder.
- **Dashboard** — `platform/grafana/dashboards/titan-overview.json`. Every panel
  references the datasource by the fixed uid `titan-clickhouse`, so the wiring
  survives re-provisioning.
- Default time range is **last 24h**, auto-refresh every **10s**.

## Dashboard: TITAN Overview

| Panel | Type | What it shows |
|---|---|---|
| **Total Requests** | Stat | Count of all requests in the selected window. |
| **Block Rate** | Stat | Percentage of requests that were blocked or flagged (`action != 'ALLOWED'`). Green < 5%, red ≥ 20%. |
| **Avg Risk Score** | Stat | Mean ML risk score (0–1). Yellow ≥ 0.5, red ≥ 0.8. |
| **p99 Latency** | Stat | 99th percentile gateway latency (`quantile(0.99)(latency_ms)`), in ms. |
| **Requests vs Blocked (per hour)** | Timeseries | Total requests vs the blocked/flagged subset, bucketed by `toStartOfHour(timestamp)`. |
| **Requests by Action** | Pie (donut) | Outcome distribution: `ALLOWED`, `ML_BLOCKED`, `CEDAR_BLOCKED`, `RATE_LIMITED`, `PII_MASKED`. |
| **Top Threats by Action** | Table | Top 10 non-ALLOWED actions with count, average risk score, and last seen timestamp. |
| **Latency: avg & p99 (per hour)** | Timeseries | Average and p99 latency over time. |

All queries use the `$__timeFilter(timestamp)` macro so they follow the
dashboard's time-range picker.
