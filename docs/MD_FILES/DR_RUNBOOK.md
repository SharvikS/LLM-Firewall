# TITAN Gateway — Backup & Disaster-Recovery Runbook

## What holds state

| Store | Contents | Durability need |
|---|---|---|
| **CockroachDB** | tenants, users, api_keys, policies, gateway_settings, audit log | **Critical** — back up |
| Redis | rate-limit windows, exact cache, **billing usage counters** | Rebuildable; usage counters are best-effort (see note) |
| ClickHouse | analytics rollups | Rebuildable from the audit stream |
| Kafka/Redpanda | in-flight audit events | Transient |

The database is the only hard-to-rebuild store and the only one that must be
backed up. Redis billing counters reset monthly and are best-effort by design;
for billing-grade durability, periodically snapshot `billing:usage:*` to the DB
(future work) or enable Redis AOF persistence.

## Targets

- **RPO (max data loss):** ≤ 24h with daily backups; ≤ 1h if run hourly.
- **RTO (max downtime):** ≤ 30 min for a single-DB restore (small dataset).

## Backup

```bash
# Local / demo (writes into the cockroach node — NOT durable across node loss):
./scripts/backup.sh

# Production — point at object storage and schedule (cron / k8s CronJob):
BACKUP_URI='s3://my-bucket/titan?AWS_ACCESS_KEY_ID=…&AWS_SECRET_ACCESS_KEY=…' ./scripts/backup.sh
```

CockroachDB **core** full backups are free. Schedule daily (or hourly) and keep
≥ 14 days of history. Always back up to off-node object storage in production.

## Restore

```bash
# Restores the latest backup into a staging DB (titan_restore) for verification:
./scripts/restore.sh
BACKUP_URI='s3://my-bucket/titan?…' ./scripts/restore.sh
```

1. Stop or quiesce the gateway (it fails closed without a DB, so it won't serve
   stale data).
2. Run `restore.sh` → restores into `titan_restore` (non-destructive to live).
3. Verify: `SELECT count(*) FROM titan_restore.tenants;` and spot-check users.
4. Cut over: repoint `DB_CONN_STRING` at `titan_restore`, or
   `DROP DATABASE defaultdb; ALTER DATABASE titan_restore RENAME TO defaultdb;`
5. Restart the gateway; confirm `/ready` is green and a test request flows.

## Verification cadence

A backup you have never restored is not a backup. Run a restore drill into the
staging DB at least monthly and confirm row counts match. This procedure was
verified end-to-end (backup → restore into staging → row count check) on
2026-06-14.

## Multi-region note

The Helm chart (`helm/titan/`) supports multi-region deployment. CockroachDB is
itself distributed and survives node/zone loss when run as a ≥ 3-node cluster;
the logical backup above is the cross-cluster / point-in-time recovery layer on
top of that.
