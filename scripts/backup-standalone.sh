#!/bin/bash
# =============================================================================
# memu-core backup — nightly pg_dump + spaces tarball for the STANDALONE stack
# =============================================================================
# Runs against the standalone deployment (own pgvector container, own data
# dir). Does NOT touch memu-os, Immich, Synapse, or the existing memu-os
# nightly backup job.
#
# Backs up:
#   1. Postgres logical dump of the `memu_core` database
#      (schema + data + sequences; excludes oidc volatile tables via exclusion).
#   2. Tarball of the spaces/ tree INCLUDING its .git/ directory so commit
#      history is preserved — catastrophic-loss territory per
#      docs/INTEGRATION_CONTRACTS.md §5.
#
# Does NOT back up:
#   - /mnt/memu-data/memu-core-standalone/tmp/ — ephemeral snapshot + export
#     staging, safe to lose.
#   - /mnt/memu-data/memu-core-standalone/documents/ — uploaded source files;
#     consider adding in a later iteration if families want original PDFs.
#   - /mnt/memu-data/memu-core-standalone/auth_info_baileys/ — WhatsApp
#     session state; safer to re-pair than to back up secrets to disk.
#   - Postgres data dir at /mnt/memu-data/memu-core-standalone/postgres/ —
#     logical dump is the canonical backup, the binary data dir is just cache.
#
# Retention: 14 days. Anything older than that in $BACKUP_DIR is pruned.
#
# Gotchas:
#   - Uses `docker exec` so Postgres keeps serving; no downtime.
#   - Tarball over spaces/ runs with `git gc` already done weekly (04:00 Mon
#     cron in the app), so pack files are representative size.
#   - `set -o pipefail` so a silent failure in pg_dump mid-stream surfaces
#     as a non-zero exit from this script and the cron log shows it.
#
# Usage:
#   sudo ./scripts/backup-standalone.sh
#
# Install (one-time, see §9.3 of memu-build-plan.md for restore + verify):
#   sudo cp scripts/backup-standalone.sh /usr/local/bin/memu-core-standalone-backup.sh
#   sudo chmod +x /usr/local/bin/memu-core-standalone-backup.sh
#   (crontab -l 2>/dev/null; \
#    echo "0 3 * * * /usr/local/bin/memu-core-standalone-backup.sh \
#      >> /var/log/memu-core-backup.log 2>&1") | crontab -
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${GREEN}[BACKUP]${NC} $1"; }
warn()  { echo -e "${YELLOW}[BACKUP]${NC} $1"; }
die()   { echo -e "${RED}[BACKUP]${NC} $1"; exit 1; }

STAMP=$(date +%Y%m%d_%H%M%S)
DATA_ROOT=${MEMU_CORE_DATA_ROOT:-/mnt/memu-data/memu-core-standalone}
BACKUP_DIR=${MEMU_CORE_BACKUP_DIR:-$DATA_ROOT/backups}
SPACES_DIR=$DATA_ROOT/spaces
DB_CONTAINER=${MEMU_CORE_DB_CONTAINER:-memu_core_standalone_db}
DB_USER=${MEMU_CORE_DB_USER:-memu}
DB_NAME=${MEMU_CORE_DB_NAME:-memu_core}
RETENTION_DAYS=${MEMU_CORE_BACKUP_RETENTION_DAYS:-14}

log "Run started $(date --iso-8601=seconds)"
log "Data root: $DATA_ROOT"
log "Backup dir: $BACKUP_DIR"
log "Container:  $DB_CONTAINER   DB: $DB_NAME   User: $DB_USER"

# ---------- preflight ------------------------------------------------------

command -v docker >/dev/null 2>&1 || die "docker not on PATH"

if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -q true; then
  die "Container $DB_CONTAINER is not running. Start the standalone stack first."
fi

if [ ! -d "$SPACES_DIR" ]; then
  die "Spaces dir not found: $SPACES_DIR"
fi

mkdir -p "$BACKUP_DIR"

# ---------- 1. Postgres dump ----------------------------------------------

DB_OUT="$BACKUP_DIR/db_${STAMP}.sql"
DB_TMP="${DB_OUT}.partial"

log "Dumping $DB_NAME → $DB_OUT"
if docker exec "$DB_CONTAINER" pg_dump \
      --username="$DB_USER" \
      --dbname="$DB_NAME" \
      --no-owner \
      --no-privileges \
      > "$DB_TMP"; then
  mv "$DB_TMP" "$DB_OUT"
  DB_BYTES=$(stat -c%s "$DB_OUT")
  log "Postgres dump OK ($DB_BYTES bytes)"
else
  rm -f "$DB_TMP"
  die "pg_dump failed — previous day's backup is still on disk. Check the container."
fi

# ---------- 2. Spaces tarball ---------------------------------------------

SP_OUT="$BACKUP_DIR/spaces_${STAMP}.tar.gz"
SP_TMP="${SP_OUT}.partial"

log "Tarring $SPACES_DIR → $SP_OUT"
if tar czf "$SP_TMP" -C "$DATA_ROOT" spaces; then
  mv "$SP_TMP" "$SP_OUT"
  SP_BYTES=$(stat -c%s "$SP_OUT")
  log "Spaces tarball OK ($SP_BYTES bytes)"
else
  rm -f "$SP_TMP"
  warn "Spaces tarball failed — Postgres dump is still intact at $DB_OUT"
  exit 1
fi

# ---------- 3. Retention ---------------------------------------------------

log "Pruning backups older than ${RETENTION_DAYS} days from $BACKUP_DIR"
PRUNED_DB=$(find "$BACKUP_DIR" -maxdepth 1 -name 'db_*.sql' -mtime "+$RETENTION_DAYS" -print -delete | wc -l)
PRUNED_SP=$(find "$BACKUP_DIR" -maxdepth 1 -name 'spaces_*.tar.gz' -mtime "+$RETENTION_DAYS" -print -delete | wc -l)
PRUNED_TMP=$(find "$BACKUP_DIR" -maxdepth 1 -name '*.partial' -mtime +1 -print -delete | wc -l)
log "Pruned: $PRUNED_DB db dumps, $PRUNED_SP spaces tarballs, $PRUNED_TMP stale .partial files"

# ---------- 4. Summary -----------------------------------------------------

DB_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'db_*.sql' | wc -l)
SP_COUNT=$(find "$BACKUP_DIR" -maxdepth 1 -name 'spaces_*.tar.gz' | wc -l)
TOTAL_BYTES=$(du -sb "$BACKUP_DIR" | awk '{print $1}')

log "Kept: $DB_COUNT db dumps, $SP_COUNT spaces tarballs (total $TOTAL_BYTES bytes)"
log "Run finished $(date --iso-8601=seconds)"
