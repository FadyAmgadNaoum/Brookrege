#!/usr/bin/env bash
# Deploys a release to all three servers, one at a time, so the site stays up. Run on VPS1 as the deploy user:
#   scripts/deploy/deploy-cluster.sh <release>
#   scripts/deploy/deploy-cluster.sh --rollback          # all three back to their previous release
#
#   1. VPS1   pre-deploy backup, pgBouncer/backup images, nginx configuration (tested before it's used)
#   2. VPS2   migrations, then its API/web/admin switch over — VPS3 serves everyone meanwhile
#   3. VPS3   API/worker/web/admin switch over — VPS2 (already on the new release) serves meanwhile
# If a server fails its health checks it switches itself back (deploy.sh); this script then also switches
# back the servers already done, so all three always run the same release.
# Needs: this user can SSH to VPS2/VPS3 over the private network (docs/operations/DEPLOYMENT-RUNBOOK.md).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${BROOKREGE_ROOT:-$(cd "$HERE/../.." && pwd)}"
VPS2="${DEPLOY_VPS2:-deploy@10.0.0.2}"
VPS3="${DEPLOY_VPS3:-deploy@10.0.0.3}"
REMOTE_ROOT="${DEPLOY_REMOTE_ROOT:-/opt/brookrege}"
SUDO="${SUDO-sudo}"
log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }

local_run() { $SUDO "$HERE/deploy.sh" "$@"; }
local_rollback() { $SUDO "$HERE/rollback.sh" "$@"; }
remote() { # HOST SCRIPT ARGS… — fetch the code there first so the release's commit exists on that server
  local host="$1"; shift
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$host" "cd '$REMOTE_ROOT' && git -c safe.directory='$REMOTE_ROOT' fetch --quiet origin; sudo '$REMOTE_ROOT/scripts/deploy/$1' ${*:2}"
}

if [ "${1:-}" = "--rollback" ]; then
  log "▸ rolling back all three servers"
  rc=0
  remote "$VPS3" rollback.sh --target vps3 || rc=1
  remote "$VPS2" rollback.sh --target vps2 || rc=1
  local_rollback --target vps1 || rc=1
  [ $rc = 0 ] && log "✓ all servers rolled back" || log "✗ at least one rollback failed — see above"
  exit $rc
fi

TAG="${1:-}"
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "usage: $0 <release (git commit)> | --rollback"; exit 64; }
git -c safe.directory="$ROOT" -C "$ROOT" fetch --quiet origin || true
TAG="$(git -c safe.directory="$ROOT" -C "$ROOT" rev-parse --short=12 "$TAG^{commit}" 2>/dev/null)" || { echo "✗ release $1 not found"; exit 1; }
for h in "$VPS2" "$VPS3"; do
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$h" true || { echo "✗ can't reach $h over SSH — nothing was changed"; exit 1; }
done
START=$(date +%s)

log "▸ 1/3 VPS1 (backup, database pool, load balancer)"
local_run --target vps1 --tag "$TAG" || { log "✗ VPS1 failed — nothing else was changed"; exit 1; }

log "▸ 2/3 VPS2 (migrations + app)"
if ! remote "$VPS2" deploy.sh --target vps2 --tag "$TAG" --skip-backup; then
  log "✗ VPS2 failed (it switched itself back) — switching VPS1 back too"
  local_rollback --target vps1; exit 1
fi

log "▸ 3/3 VPS3 (app + background jobs)"
if ! remote "$VPS3" deploy.sh --target vps3 --tag "$TAG" --skip-backup --no-migrate; then
  log "✗ VPS3 failed (it switched itself back) — switching VPS2 and VPS1 back too"
  remote "$VPS2" rollback.sh --target vps2; local_rollback --target vps1; exit 1
fi
log "✓ all three servers run $TAG ($(( $(date +%s) - START )) s)"
