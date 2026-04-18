#!/bin/bash
# =============================================================================
# memu-core db-init — create the memu_core database inside memu-os's Postgres
# =============================================================================
# Must NEVER touch existing memu-os databases (Immich / Synapse / Baikal).
# Whitelist-only operations: creates memu_core DB and enables pgvector on it.
# Idempotent: safe to re-run. Does not reset data.
#
# Requires:
#   - memu-os running with memu_postgres container healthy (preflight.sh pass).
#   - DB_PASSWORD env var set (same password memu-os uses for memu_user) OR
#     MEMU_OS_ENV_FILE pointing at memu-os's .env.
#
# Usage:
#   sudo DB_PASSWORD='...' ./scripts/db-init.sh
#   # OR
#   sudo MEMU_OS_ENV_FILE=/path/to/memu-os/.env ./scripts/db-init.sh
# =============================================================================

set -eu

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${GREEN}[DB-INIT]${NC} $1"; }
warn()  { echo -e "${YELLOW}[DB-INIT]${NC} $1"; }
die()   { echo -e "${RED}[DB-INIT]${NC} $1"; exit 1; }

CONTAINER=${MEMU_POSTGRES_CONTAINER:-memu_postgres}
TARGET_DB=${MEMU_CORE_DB:-memu_core}
TARGET_USER=${MEMU_CORE_DB_USER:-memu_user}

# -- Pre-checks ---------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker not on PATH."
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "Container $CONTAINER not found. Run preflight.sh first."

state=$(docker inspect -f '{{.State.Status}}' "$CONTAINER")
[ "$state" = "running" ] || die "Container $CONTAINER is '$state', expected 'running'."

# -- Password resolution ------------------------------------------------------
if [ -z "${DB_PASSWORD:-}" ] && [ -n "${MEMU_OS_ENV_FILE:-}" ]; then
  [ -r "$MEMU_OS_ENV_FILE" ] || die "MEMU_OS_ENV_FILE=$MEMU_OS_ENV_FILE not readable."
  DB_PASSWORD=$(grep -E '^DB_PASSWORD=' "$MEMU_OS_ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
fi
[ -n "${DB_PASSWORD:-}" ] || die "DB_PASSWORD not set (pass via env or MEMU_OS_ENV_FILE)."

# -- Verify we can talk to Postgres ------------------------------------------
log "Verifying connection to $CONTAINER as $TARGET_USER..."
if ! docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
     psql -U "$TARGET_USER" -d postgres -tAc 'SELECT 1' >/dev/null 2>&1; then
  die "Failed to authenticate as $TARGET_USER. Is DB_PASSWORD correct?"
fi
log "Connection OK."

# -- Safety: confirm which databases exist so we never clobber ---------------
log "Databases currently on this instance (for audit):"
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
  psql -U "$TARGET_USER" -d postgres -tAc \
  "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname" \
  | sed 's/^/    /'

# -- Idempotent create of memu_core database ---------------------------------
exists=$(docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
  psql -U "$TARGET_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$TARGET_DB'")

if [ "$exists" = "1" ]; then
  log "Database '$TARGET_DB' already exists — leaving as-is (idempotent)."
else
  log "Creating database '$TARGET_DB' with owner $TARGET_USER..."
  docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
    psql -U "$TARGET_USER" -d postgres -v ON_ERROR_STOP=1 -c \
    "CREATE DATABASE \"$TARGET_DB\" OWNER \"$TARGET_USER\" ENCODING 'UTF8'" \
    || die "CREATE DATABASE failed."
  log "Database created."
fi

# -- Enable pgvector inside memu_core ONLY (never against other DBs) ---------
log "Ensuring pgvector extension inside '$TARGET_DB'..."
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
  psql -U "$TARGET_USER" -d "$TARGET_DB" -v ON_ERROR_STOP=1 -c \
  "CREATE EXTENSION IF NOT EXISTS vector" \
  || die "Failed to create pgvector extension."
log "pgvector extension ready."

# -- Final audit: confirm we only touched memu_core --------------------------
log "Post-init state:"
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" \
  psql -U "$TARGET_USER" -d "$TARGET_DB" -tAc \
  "SELECT current_database(), current_user, (SELECT string_agg(extname, ', ') FROM pg_extension)" \
  | sed 's/^/    /'

echo
log "Done. memu-core can now run migrations:"
echo "    cd $(dirname "$(cd "$(dirname "$0")" && pwd)") && node run-migration.mjs"
