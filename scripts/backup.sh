#!/usr/bin/env bash
# Logical backup of the TITAN control-plane database (tenants, users, api_keys,
# policies, gateway_settings, audit log). Uses CockroachDB core BACKUP, which is
# free for full backups.
#
#   ./scripts/backup.sh                       # local: backup into the cockroach node
#   BACKUP_URI='s3://bucket/titan?AUTH=...' ./scripts/backup.sh   # production: cloud
#
# For production, point BACKUP_URI at object storage (S3/GCS/Azure) and run this
# on a schedule (cron / k8s CronJob). nodelocal is fine for local/demo only —
# it lives on the node's disk and is not durable across a node loss.
set -euo pipefail

CONTAINER="${COCKROACH_CONTAINER:-titan-llm-firewall-cockroachdb-1}"
DB="${DB_NAME:-defaultdb}"
URI="${BACKUP_URI:-nodelocal://1/titan-backup}"

echo "Backing up '$DB' INTO '$URI' …"
docker exec "$CONTAINER" ./cockroach sql --insecure -d "$DB" \
  -e "BACKUP INTO '$URI' AS OF SYSTEM TIME '-10s';"

echo "Available backups:"
docker exec "$CONTAINER" ./cockroach sql --insecure \
  -e "SHOW BACKUPS IN '$URI';"

echo "Done. Restore with: ./scripts/restore.sh"
