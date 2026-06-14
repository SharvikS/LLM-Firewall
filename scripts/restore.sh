#!/usr/bin/env bash
# Restore the TITAN control-plane database from the latest backup.
#
#   ./scripts/restore.sh                      # restore latest from nodelocal
#   BACKUP_URI='s3://bucket/titan?AUTH=...' ./scripts/restore.sh
#
# DESTRUCTIVE: RESTORE overwrites existing tables. The gateway should be stopped
# (or in maintenance) during a restore. This restores into a staging database
# first so you can verify before swapping — see docs/MD_FILES/DR_RUNBOOK.md.
set -euo pipefail

CONTAINER="${COCKROACH_CONTAINER:-titan-llm-firewall-cockroachdb-1}"
URI="${BACKUP_URI:-nodelocal://1/titan-backup}"
TARGET_DB="${RESTORE_DB:-titan_restore}"

echo "Latest backups in '$URI':"
docker exec "$CONTAINER" ./cockroach sql --insecure \
  -e "SHOW BACKUPS IN '$URI';"

echo "Restoring latest into a staging database '$TARGET_DB' (verify before swap)…"
docker exec "$CONTAINER" ./cockroach sql --insecure -e "
  DROP DATABASE IF EXISTS $TARGET_DB CASCADE;
  RESTORE DATABASE defaultdb FROM LATEST IN '$URI' WITH new_db_name = '$TARGET_DB';
"

echo "Restored into '$TARGET_DB'. Verify it, then repoint DB_CONN_STRING or swap names."
