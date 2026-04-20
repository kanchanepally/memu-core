#!/bin/bash
# =============================================================================
# memu-core preflight — before docking onto a memu-os v1.1+ Z2 host
# =============================================================================
# Verifies that the host meets every precondition in Part B of the build
# backlog before memu-core is deployed alongside memu-os. Runs read-only.
# Never modifies host state; safe to run repeatedly.
#
# Usage: sudo ./scripts/preflight.sh
# Exit code: 0 if all checks pass, 1 if any hard-fail, 2 if warnings only.
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

# Required containers from memu-os v1.1. 11 expected.
REQUIRED_CONTAINERS=(
  memu_proxy
  memu_intelligence
  memu_photos
  memu_synapse
  memu_calendar
  memu_redis
  memu_postgres
  memu_element
  memu_photos_ml
  memu_bootstrap
  memu_brain
)

MIN_FREE_ROOT_GB=20
MIN_FREE_DATA_GB=50
MIN_BACKUP_AGE_HOURS=24
FRESH_BACKUP_HOURS=2
BACKUP_DIR_DEFAULT=/mnt/memu-data/backups
BACKUP_DIR=${MEMU_BACKUP_DIR:-$BACKUP_DIR_DEFAULT}

echo -e "${BOLD}memu-core preflight — $(date -Iseconds)${NC}"
echo

# -- 1. Run context -----------------------------------------------------------
echo -e "${BOLD}[1/6] Run context${NC}"
if [ "$(id -u)" != "0" ]; then
  fail "Run as root (sudo). Needed for systemctl + docker + /mnt paths."
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

# -- 2. memu-os v1.1 signals --------------------------------------------------
echo
echo -e "${BOLD}[2/6] memu-os v1.1 signals${NC}"
# Host Tailscale (v1.1 moved Tailscale from container to host OS).
if systemctl is-active --quiet tailscaled; then
  pass "tailscaled running on host (v1.1 Tailscale-on-host present)."
else
  fail "tailscaled not active on host — memu-os looks pre-v1.1."
fi

# Backup timer (v1.1 introduced zero-downtime backup via pg_dumpall).
if systemctl list-timers --all 2>/dev/null | grep -q memu-backup.timer; then
  if systemctl is-enabled --quiet memu-backup.timer 2>/dev/null; then
    pass "memu-backup.timer enabled."
  else
    warn "memu-backup.timer present but not enabled."
  fi
else
  fail "memu-backup.timer not found — v1.1 backup job missing."
fi

# Watchdog script.
if [ -x /usr/local/bin/memu-watchdog.sh ]; then
  pass "memu-watchdog.sh present and executable."
else
  fail "memu-watchdog.sh missing at /usr/local/bin/ — v1.1 watchdog missing."
fi

# -- 3. Container health ------------------------------------------------------
echo
echo -e "${BOLD}[3/6] memu-os containers (${#REQUIRED_CONTAINERS[@]} expected)${NC}"
for name in "${REQUIRED_CONTAINERS[@]}"; do
  status=$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$name" 2>/dev/null || true)
  if [ -z "$status" ]; then
    fail "$name not found."
    continue
  fi
  state=${status%%|*}
  health=${status##*|}
  if [ "$state" != "running" ]; then
    fail "$name is '$state' (expected running)."
  elif [ "$health" = "unhealthy" ]; then
    fail "$name running but healthcheck reports unhealthy."
  elif [ "$health" = "no-healthcheck" ]; then
    pass "$name running (no healthcheck defined)."
  else
    pass "$name running + healthy."
  fi
done

# -- 4. Disk space ------------------------------------------------------------
echo
echo -e "${BOLD}[4/6] Disk space${NC}"
root_free_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
if [ -n "$root_free_gb" ] && [ "$root_free_gb" -ge "$MIN_FREE_ROOT_GB" ]; then
  pass "Root filesystem has ${root_free_gb}GB free (need ${MIN_FREE_ROOT_GB}GB)."
else
  fail "Root filesystem has ${root_free_gb:-?}GB free (need ${MIN_FREE_ROOT_GB}GB)."
fi

if [ -d /mnt/memu-data ]; then
  data_free_gb=$(df -BG --output=avail /mnt/memu-data | tail -1 | tr -dc '0-9')
  if [ -n "$data_free_gb" ] && [ "$data_free_gb" -ge "$MIN_FREE_DATA_GB" ]; then
    pass "/mnt/memu-data has ${data_free_gb}GB free (need ${MIN_FREE_DATA_GB}GB)."
  else
    fail "/mnt/memu-data has ${data_free_gb:-?}GB free (need ${MIN_FREE_DATA_GB}GB)."
  fi
else
  fail "/mnt/memu-data not mounted — expected the 4TB IronWolf data drive."
fi

# -- 5. Backup freshness ------------------------------------------------------
echo
echo -e "${BOLD}[5/6] Backup freshness${NC}"
if [ -d "$BACKUP_DIR" ]; then
  latest=$(find "$BACKUP_DIR" -type f -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1)
  if [ -z "$latest" ]; then
    fail "$BACKUP_DIR exists but contains no backup files."
  else
    latest_ts=${latest%% *}
    latest_path=${latest#* }
    now_ts=$(date +%s)
    age_hours=$(( (now_ts - ${latest_ts%.*}) / 3600 ))
    if [ "$age_hours" -le "$FRESH_BACKUP_HOURS" ]; then
      pass "Most recent backup ${age_hours}h old ($(basename "$latest_path")) — fresh."
    elif [ "$age_hours" -le "$MIN_BACKUP_AGE_HOURS" ]; then
      warn "Most recent backup ${age_hours}h old — within 24h but not same-session. Run an ad-hoc backup before deploy."
    else
      fail "Most recent backup ${age_hours}h old — older than ${MIN_BACKUP_AGE_HOURS}h. Run backup.sh and re-check."
    fi
  fi
else
  fail "Backup directory $BACKUP_DIR not found."
fi

# -- 6. memu-core side --------------------------------------------------------
echo
echo -e "${BOLD}[6/6] memu-core side${NC}"
if docker network inspect memu-suite_memu_net >/dev/null 2>&1; then
  pass "Docker network memu-suite_memu_net exists (memu-core will join)."
else
  fail "Docker network memu-suite_memu_net missing — memu-os stack not up."
fi

if docker inspect memu_core >/dev/null 2>&1; then
  warn "Container memu_core already exists — preflight assumes fresh dock. Remove before deploying, or treat this as re-deploy."
else
  pass "No existing memu_core container (fresh dock path)."
fi

# -- Summary ------------------------------------------------------------------
echo
echo -e "${BOLD}Summary${NC}"
if [ "$FAILS" -gt 0 ]; then
  echo -e "  ${RED}${FAILS} failure(s)${NC}, ${WARNS} warning(s). DO NOT proceed."
  exit 1
elif [ "$WARNS" -gt 0 ]; then
  echo -e "  ${YELLOW}0 failures, ${WARNS} warning(s).${NC} Review before proceeding."
  exit 2
else
  echo -e "  ${GREEN}All checks passed.${NC} Safe to run db-init.sh + docker compose -f docker-compose.home.yml up."
  exit 0
fi
