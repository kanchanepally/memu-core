#!/bin/bash
# =============================================================================
# memu-core preflight-standalone — before bringing up docker-compose.standalone.yml
# =============================================================================
# Lightweight sibling of preflight.sh (which is for B-dock, the future shared-
# Postgres mode). This one runs before every `docker compose -f
# docker-compose.standalone.yml up -d --build` on the Z2.
#
# Read-only. Never modifies host state. Safe to run repeatedly.
#
# Four checks:
#   1. Data disk /mnt/memu-data has ≥50GB free.
#   2. Port 3100 is free OR already bound by our own memu_core_standalone_api.
#   3. Immich (memu_photos) is healthy — don't deploy onto a misbehaving Z2.
#   4. /mnt/memu-data/memu-core-standalone/postgres/ is empty OR owned by our
#      own memu_core_standalone_db container (prevents accidental double-init
#      from an orphaned previous install).
#
# Does NOT check memu-os v1.1 signals (tailscaled, memu-backup.timer, watchdog)
# — those are B-dock concerns. Standalone mode deliberately doesn't depend on
# any of them.
#
# Usage:
#   sudo ./scripts/preflight-standalone.sh
#
# Exit: 0 all pass, 1 any hard-fail, 2 warnings only.
# =============================================================================

set -u

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}PASS${NC}  $1"; }
fail() { echo -e "  ${RED}FAIL${NC}  $1"; FAILS=$((FAILS+1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}  $1"; WARNS=$((WARNS+1)); }
info() { echo -e "  ${BOLD}INFO${NC}  $1"; }

FAILS=0
WARNS=0

MIN_FREE_DATA_GB=50
API_PORT=3100
DATA_ROOT=${MEMU_CORE_DATA_ROOT:-/mnt/memu-data/memu-core-standalone}
POSTGRES_DIR=$DATA_ROOT/postgres
API_CONTAINER=${MEMU_CORE_API_CONTAINER:-memu_core_standalone_api}
DB_CONTAINER=${MEMU_CORE_DB_CONTAINER:-memu_core_standalone_db}
IMMICH_CONTAINER=${MEMU_CORE_IMMICH_CONTAINER:-memu_photos}

echo -e "${BOLD}memu-core preflight-standalone — $(date -Iseconds)${NC}"
echo

# -- 0. Run context -----------------------------------------------------------
echo -e "${BOLD}[0/4] Run context${NC}"
if [ "$(id -u)" != "0" ]; then
  warn "Not running as root. Some checks (port bind, dir contents under /mnt) may be partial."
else
  pass "Running as root."
fi
if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    pass "docker daemon responsive."
  else
    fail "docker installed but daemon not responding."
  fi
else
  fail "docker not found on PATH."
fi

# -- 1. Disk space on data drive ---------------------------------------------
echo
echo -e "${BOLD}[1/4] Disk space on /mnt/memu-data${NC}"
if [ ! -d /mnt/memu-data ]; then
  fail "/mnt/memu-data does not exist — the 4TB drive isn't mounted."
else
  data_free_gb=$(df -BG --output=avail /mnt/memu-data | tail -1 | tr -dc '0-9')
  if [ -n "$data_free_gb" ] && [ "$data_free_gb" -ge "$MIN_FREE_DATA_GB" ]; then
    pass "/mnt/memu-data has ${data_free_gb}GB free (need ${MIN_FREE_DATA_GB}GB)."
  else
    fail "/mnt/memu-data has ${data_free_gb:-?}GB free (need ${MIN_FREE_DATA_GB}GB)."
  fi
fi

# -- 2. Port 3100 -------------------------------------------------------------
echo
echo -e "${BOLD}[2/4] Port $API_PORT availability${NC}"
port_holder=""
if command -v ss >/dev/null 2>&1; then
  port_holder=$(ss -tlnpH "sport = :$API_PORT" 2>/dev/null | head -1)
elif command -v netstat >/dev/null 2>&1; then
  port_holder=$(netstat -tlnp 2>/dev/null | awk -v p=":$API_PORT" '$4 ~ p {print}' | head -1)
else
  warn "Neither ss nor netstat available — can't verify port $API_PORT state."
  port_holder="__skip__"
fi

if [ -z "$port_holder" ]; then
  pass "Port $API_PORT free."
elif [ "$port_holder" = "__skip__" ]; then
  :
else
  # Someone is listening. Is it our own API container?
  api_state=$(docker inspect -f '{{.State.Running}}' "$API_CONTAINER" 2>/dev/null || true)
  if [ "$api_state" = "true" ]; then
    pass "Port $API_PORT bound by our own $API_CONTAINER (stack already up — safe)."
  else
    fail "Port $API_PORT bound by something other than $API_CONTAINER. Free it before deploy."
    info "Holder: $port_holder"
  fi
fi

# -- 3. Immich (memu_photos) healthy ----------------------------------------
echo
echo -e "${BOLD}[3/4] Immich ($IMMICH_CONTAINER)${NC}"
immich_state=$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$IMMICH_CONTAINER" 2>/dev/null || true)
if [ -z "$immich_state" ]; then
  fail "$IMMICH_CONTAINER not found. Memu-os may be down — don't deploy onto a half-broken Z2."
else
  state=${immich_state%%|*}
  health=${immich_state##*|}
  if [ "$state" != "running" ]; then
    fail "$IMMICH_CONTAINER state is '$state' (expected running)."
  elif [ "$health" = "unhealthy" ]; then
    fail "$IMMICH_CONTAINER running but healthcheck reports unhealthy. Fix it first."
  elif [ "$health" = "no-healthcheck" ]; then
    warn "$IMMICH_CONTAINER running (no healthcheck defined — can't verify)."
  else
    pass "$IMMICH_CONTAINER running + healthy."
  fi
fi

# -- 4. Postgres data dir sanity ---------------------------------------------
echo
echo -e "${BOLD}[4/4] Postgres data dir ($POSTGRES_DIR)${NC}"
if [ ! -d "$POSTGRES_DIR" ]; then
  info "$POSTGRES_DIR does not exist yet — will be created on first `up`."
  pass "No data dir conflict."
else
  contents=$(ls -A "$POSTGRES_DIR" 2>/dev/null | head -1)
  if [ -z "$contents" ]; then
    pass "$POSTGRES_DIR is empty — clean first boot."
  else
    db_state=$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)
    if [ -n "$db_state" ]; then
      pass "$POSTGRES_DIR populated and $DB_CONTAINER exists — reusing existing DB."
    else
      fail "$POSTGRES_DIR is non-empty but $DB_CONTAINER doesn't exist — orphaned data. Either re-create the container or move $POSTGRES_DIR aside before deploy."
    fi
  fi
fi

# -- Summary ------------------------------------------------------------------
echo
echo -e "${BOLD}Summary${NC}"
if [ "$FAILS" -eq 0 ] && [ "$WARNS" -eq 0 ]; then
  echo -e "  ${GREEN}All checks passed.${NC} Safe to run: docker compose -f docker-compose.standalone.yml up -d --build"
  exit 0
elif [ "$FAILS" -eq 0 ]; then
  echo -e "  ${YELLOW}$WARNS warning(s), 0 failures.${NC} Deploy possible but address warnings first."
  exit 2
else
  echo -e "  ${RED}$FAILS failure(s), $WARNS warning(s).${NC} Do not deploy."
  exit 1
fi
