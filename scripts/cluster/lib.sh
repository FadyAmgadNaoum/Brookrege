#!/usr/bin/env bash
# Shared helpers. Two modes, same scripts:
#   CLUSTER_MODE=local  (default)  the simulation in docker-compose.cluster.yml
#   CLUSTER_MODE=ssh               the real servers; set VPS1_SSH / VPS2_SSH / VPS3_SSH (e.g. deploy@203.0.113.10)
# Targets are written as <node>:<service>, e.g. vps1:postgres. In local mode they map to compose services.
set -euo pipefail

MODE="${CLUSTER_MODE:-local}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_DIR="${REMOTE_DIR:-/opt/brookrege}"
DB_USER="${DB_USER:-brookrege}"
DB_NAME="${DB_NAME:-brookrege}"

# Logical target -> local compose service
local_service() {
  case "$1" in
    vps1:postgres) echo pg-primary ;;   vps2:postgres) echo pg-replica ;;
    vps1:pgbouncer) echo pgbouncer ;;   vps1:nginx) echo lb ;;
    vps2:api) echo api-1 ;; vps2:web) echo web-1 ;; vps2:admin) echo admin-1 ;;
    vps3:api) echo api-2 ;; vps3:web) echo web-2 ;; vps3:admin) echo admin-2 ;;
    *) echo "unknown target $1" >&2; return 1 ;;
  esac
}

ssh_dest() {
  case "$1" in
    vps1) echo "${VPS1_SSH:?set VPS1_SSH}" ;; vps2) echo "${VPS2_SSH:?set VPS2_SSH}" ;; vps3) echo "${VPS3_SSH:?set VPS3_SSH}" ;;
  esac
}

# compose <target> <compose args...>   e.g. compose vps1:postgres stop
compose() {
  local target="$1"; shift
  local node="${target%%:*}" svc="${target#*:}"
  if [ "$MODE" = local ]; then
    docker compose -f "$ROOT/docker-compose.cluster.yml" "$@" "$(local_service "$target")"
  else
    ssh -o ConnectTimeout=5 "$(ssh_dest "$node")" "cd $REMOTE_DIR/infra/servers/$node && docker compose --env-file ../../../.env.cluster $* $svc"
  fi
}

# run <target> <command...>  — runs inside the container (stdin passed through)
run() {
  local target="$1"; shift
  local node="${target%%:*}" svc="${target#*:}"
  if [ "$MODE" = local ]; then
    docker compose -f "$ROOT/docker-compose.cluster.yml" exec -T "$(local_service "$target")" "$@"
  else
    local q; q=$(printf '%q ' "$@")
    ssh -o ConnectTimeout=5 "$(ssh_dest "$node")" "cd $REMOTE_DIR/infra/servers/$node && docker compose --env-file ../../../.env.cluster exec -T $svc $q"
  fi
}

# sql <target> "<SQL>"  — one value, no headers. Uses the container's local socket (trust).
sql() { printf '%s\n' "$2" | run "$1" psql -X -q -t -A -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1; }

# Public URLs of the load balancer
LB_URL="${LB_URL:-$([ "$MODE" = local ] && echo http://localhost:8080 || echo "https://${PUBLIC_DOMAIN:-brookrege.com}")}"

# Milliseconds since epoch (GNU date supports %3N; macOS date does not, so fall back to seconds*1000).
now_ms() { local t; t=$(date +%s%3N 2>/dev/null || true); case "$t" in ''|*N) echo $(( $(date +%s) * 1000 )) ;; *) echo "$t" ;; esac; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
