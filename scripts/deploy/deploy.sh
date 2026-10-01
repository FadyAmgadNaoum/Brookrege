#!/usr/bin/env bash
# Deploys one release (a git commit whose images GitHub Actions built) to THIS server, safely:
#   1. checks: settings file, free disk, the release exists, nginx accepts the new configuration
#   2. downloads the release's images (nothing running is touched yet)
#   3. takes an encrypted database backup                          (servers that hold the database)
#   4. applies database migrations                                 (servers that run the API)
#   5. switches the containers to the new release
#   6. health checks; if anything is unhealthy it switches back to the previous release automatically
# Every step is logged to /var/lib/brookrege/deploy/history.log and reported to monitoring.
#
#   sudo scripts/deploy/deploy.sh --target single|staging|vps1|vps2|vps3 --tag <release>
#     --tag           git commit (12 characters, as shown in GitHub › Actions › Release images)
#     --skip-backup   don't take the pre-deploy backup (the cluster script takes it once, on VPS1)
#     --no-migrate    don't run migrations (rollbacks; the second app server in the cluster)
#     --no-rollback   leave a failed release running (only to investigate with someone watching)
#     --force         deploy even if this release is already running
# Three servers: run scripts/deploy/deploy-cluster.sh on VPS1 instead. Guide: docs/operations/DEPLOYMENT-RUNBOOK.md
#
# The whole script is one function, so a `git checkout` of a newer version of this file mid-run can't
# change what's executing.
main() {
set -Eeuo pipefail
trap 'echo "✗ deploy.sh stopped unexpectedly at line $LINENO (exit $?) — check: docker compose ps; RUNBOOKS.md › Deploy failed"' ERR
ROOT="${BROOKREGE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
STATE_DIR="${BROOKREGE_STATE_DIR:-/var/lib/brookrege/deploy}"
TEXTFILE_DIR="${TEXTFILE_DIR:-/var/lib/node_exporter/textfile}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"     # seconds for the new containers to become healthy
HEALTH_INTERVAL="${HEALTH_INTERVAL:-3}"
MIN_FREE_MB="${MIN_FREE_MB:-2048}"

TARGET=""; TAG=""; BACKUP=1; MIGRATE=1; ROLLBACK=1; FORCE=0; MODE="deploy"
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --tag) TAG="${2:-}"; shift 2 ;;
    --skip-backup) BACKUP=0; shift ;;
    --no-migrate) MIGRATE=0; shift ;;
    --no-rollback) ROLLBACK=0; shift ;;
    --force) FORCE=1; shift ;;
    --mode) MODE="${2:-deploy}"; shift 2 ;;   # "rollback" when called by rollback.sh (wording in the log only)
    -h|--help) sed -n '2,19p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "✗ unknown option: $1 (see --help)"; exit 64 ;;
  esac
done

# ── what runs where ──
case "$TARGET" in
  single)  FILES=(-f "$ROOT/docker-compose.prod.yml"); ENVF="$ROOT/.env.production"
           APPS=(api web admin); INFRA=(backup); NGINX=1; HAS_DB=1 ;;
  staging) FILES=(-f "$ROOT/docker-compose.prod.yml" -f "$ROOT/docker-compose.staging.yml"); ENVF="$ROOT/.env.staging"
           APPS=(api web admin); INFRA=(backup); NGINX=1; HAS_DB=1 ;;
  vps1)    FILES=(-f "$ROOT/infra/servers/vps1/docker-compose.yml"); ENVF="$ROOT/.env.cluster"
           APPS=(); INFRA=(pgbouncer backup); NGINX=1; HAS_DB=1 ;;
  vps2)    FILES=(-f "$ROOT/infra/servers/vps2/docker-compose.yml"); ENVF="$ROOT/.env.cluster"
           APPS=(api web admin); INFRA=(); NGINX=0; HAS_DB=0 ;;
  vps3)    FILES=(-f "$ROOT/infra/servers/vps3/docker-compose.yml"); ENVF="$ROOT/.env.cluster"
           APPS=(api worker web admin); INFRA=(); NGINX=0; HAS_DB=0 ;;
  *) echo "✗ --target must be single, staging, vps1, vps2 or vps3"; exit 64 ;;
esac
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "✗ --tag must be a git commit (hex), got '$TAG'"; exit 64; }
HAS_API=0; for s in "${APPS[@]}"; do [ "$s" = api ] && HAS_API=1; done
[ "$HAS_API" = 1 ] || MIGRATE=0
[ "$HAS_DB" = 1 ] || BACKUP=0
SERVICES=("${APPS[@]}" "${INFRA[@]}")

GIT=(git -c safe.directory="$ROOT" -C "$ROOT")
DC() { IMAGE_TAG="$RUN_TAG" docker compose "${FILES[@]}" --env-file "$ENVF" "$@"; }
log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
STARTED=$(date +%s)

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/deploy.lock"
flock -n 9 || { echo "✗ another deploy is running on this server"; exit 75; }

CURRENT="$(cat "$STATE_DIR/current-$TARGET" 2>/dev/null || true)"
log "▸ $MODE $TARGET: ${CURRENT:-nothing recorded} → $TAG"
if [ "$CURRENT" = "$TAG" ] && [ "$FORCE" = 0 ]; then log "✓ $TAG is already running here (use --force to redeploy)"; exit 0; fi

# ── 1. checks ──
[ -f "$ENVF" ] || { echo "✗ settings file $ENVF is missing (copy the .example next to it)"; exit 1; }
perm=$(stat -c %a "$ENVF"); [ "$perm" = 600 ] || [ "$perm" = 400 ] || log "! $ENVF is readable by others (chmod 600 $ENVF)"
free=$(df -Pm "$ROOT" | awk 'NR==2{print $4}')
[ "${free:-0}" -ge "$MIN_FREE_MB" ] || { echo "✗ only ${free} MB free on disk; need ${MIN_FREE_MB} MB (docker system prune, old backups)"; exit 1; }
"${GIT[@]}" fetch --quiet origin || log "! git fetch failed — using the commits already on this server"
"${GIT[@]}" cat-file -e "$TAG^{commit}" 2>/dev/null || { echo "✗ release $TAG isn't in the repository (pushed? typo?)"; record "$TAG" failed; exit 1; }
PREV_HEAD="$("${GIT[@]}" rev-parse --short=12 HEAD)"
TAG="$("${GIT[@]}" rev-parse --short=12 "$TAG^{commit}")"   # always the 12-character form the images use

restore_checkout() { "${GIT[@]}" checkout --quiet --detach "$PREV_HEAD" || true; }
abort() { log "✗ $1 — nothing was switched; $TARGET still runs ${CURRENT:-the previous version}"; restore_checkout; record "$TAG" failed; exit 1; }

"${GIT[@]}" checkout --quiet --detach "$TAG"
RUN_TAG="$TAG"
DC config --quiet || abort "the compose file doesn't validate with this release"
NGINX_CHANGED=0
if [ "$NGINX" = 1 ]; then
  "${GIT[@]}" diff --quiet "$PREV_HEAD" "$TAG" -- infra/nginx || NGINX_CHANGED=1
  # A throw-away nginx container renders the templates and tests the configuration; the running one isn't touched.
  DC run --rm --no-deps -T nginx nginx -t >/dev/null 2>"$STATE_DIR/nginx-test.log" \
    || { cat "$STATE_DIR/nginx-test.log"; abort "nginx rejects the new configuration"; }
  if [ "$NGINX_CHANGED" = 1 ]; then log "✓ new nginx configuration OK (nginx restarts with it, ≈1 s)"; else log "✓ nginx configuration unchanged and OK"; fi
fi

# ── 2. images ──
if [ ${#SERVICES[@]} -gt 0 ]; then
  DC pull --quiet "${SERVICES[@]}" || abort "couldn't download the images for $TAG (release workflow finished? docker login ghcr.io?)"
  log "✓ images for $TAG downloaded"
fi

# ── 3. backup ──
if [ "$BACKUP" = 1 ]; then
  DC exec -T backup sh -c '. /etc/backup.env && brookrege-backup' || abort "pre-deploy backup failed"
  log "✓ pre-deploy backup taken"
fi

# ── 4. migrations ──
MIGRATED=0
if [ "$MIGRATE" = 1 ]; then
  out=$(DC run --rm --no-deps -T api npx prisma migrate deploy 2>&1) || { echo "$out" | tail -20; abort "database migration failed (the database refused it; see above)"; }
  if echo "$out" | grep -q "have been applied"; then MIGRATED=1; log "✓ migrations applied:"; echo "$out" | grep -E '^\s*└─|^\s*├─' || true
  else log "✓ no new migrations"; fi
fi

# ── 5. switch ──
set_env_tag "$TAG"
switch "$TAG" "$NGINX_CHANGED"

# ── 6. health ──
if healthy "$TAG"; then
  echo "$TAG" > "$STATE_DIR/current-$TARGET"
  [ -n "$CURRENT" ] && [ "$CURRENT" != "$TAG" ] && echo "$CURRENT" > "$STATE_DIR/previous-$TARGET"
  record "$TAG" ok
  docker image prune -f >/dev/null 2>&1 || true   # unused layers only; the last releases stay for rollbacks
  log "✓ $TARGET now runs $TAG ($(( $(date +%s) - STARTED )) s)"
  exit 0
fi

log "✗ $TAG is unhealthy on $TARGET"
if [ "$ROLLBACK" = 0 ] || [ -z "$CURRENT" ]; then
  [ -z "$CURRENT" ] && log "! no previous release recorded on this server — nothing to switch back to"
  record "$TAG" failed; exit 1
fi
log "▸ switching back to $CURRENT"
"${GIT[@]}" checkout --quiet --detach "$CURRENT" || "${GIT[@]}" checkout --quiet --detach "$PREV_HEAD"
RUN_TAG="$CURRENT"
set_env_tag "$CURRENT"
switch "$CURRENT" "$NGINX_CHANGED"
if healthy "$CURRENT"; then
  record "$TAG" rolled_back
  log "✓ rolled back: $TARGET runs $CURRENT again"
  [ "$MIGRATED" = 1 ] && log "! the database keeps the new migrations. Migrations are written to work with the previous release (DEVELOPER-GUIDE.md › Migrations); if $CURRENT misbehaves, restore the pre-deploy backup (docs/security/BACKUPS.md › Real restore)."
  exit 1
fi
record "$TAG" rollback_failed
log "✗✗ rollback to $CURRENT is ALSO unhealthy — follow RUNBOOKS.md › Site down"
exit 2
}

# ── helpers (defined before main runs) ──
set_env_tag() { # write IMAGE_TAG=<tag> into the settings file, keeping its owner and permissions
  local tmp; tmp=$(mktemp)
  if grep -q '^IMAGE_TAG=' "$ENVF"; then sed "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" "$ENVF" > "$tmp"
  else cat "$ENVF" > "$tmp"; printf '\n# Release now running — written by scripts/deploy/deploy.sh\nIMAGE_TAG=%s\n' "$1" >> "$tmp"; fi
  cat "$tmp" > "$ENVF"; rm -f "$tmp"
}

switch() { # TAG NGINX_CHANGED
  # Errors here aren't fatal: the health check that follows decides, and triggers the rollback.
  if [ ${#SERVICES[@]} -gt 0 ]; then DC up -d --no-build "${SERVICES[@]}" || log "! docker compose up reported an error"; fi
  # nginx renders its templates only at start: recreate it when its configuration changed (≈1 s), otherwise leave it.
  if [ "$NGINX" = 1 ] && [ "$2" = 1 ]; then DC up -d --no-build --no-deps --force-recreate nginx || log "! nginx restart reported an error"; fi
  log "▸ containers switched to $1; checking health (up to ${HEALTH_TIMEOUT}s)"
}

healthy() { # TAG — every container of this target up and answering, the API reporting this release
  local tag="$1" deadline=$(( $(date +%s) + HEALTH_TIMEOUT )) pending h s
  while :; do
    pending=""
    for s in "${APPS[@]}"; do
      case "$s" in
        api)    h=$(DC exec -T api wget -qO- http://127.0.0.1:4000/health 2>/dev/null || true)
                [[ "$h" == *"\"version\":\"$tag\""* ]] || pending+=" api" ;;
        web)    DC exec -T web wget -qO /dev/null http://127.0.0.1:3000/healthz 2>/dev/null || pending+=" web" ;;
        admin)  DC exec -T admin wget -qO /dev/null http://127.0.0.1:3001/healthz 2>/dev/null || pending+=" admin" ;;
        worker) [ "$(docker inspect -f '{{.State.Status}}' "$(DC ps -q worker)" 2>/dev/null)" = running ] || pending+=" worker" ;;
      esac
    done
    for s in "${INFRA[@]}"; do
      [ "$(docker inspect -f '{{.State.Status}}' "$(DC ps -q "$s")" 2>/dev/null)" = running ] || pending+=" $s"
    done
    if [ "$NGINX" = 1 ]; then DC exec -T nginx wget -qO /dev/null http://127.0.0.1:8088/stub_status 2>/dev/null || pending+=" nginx"; fi
    if [ -z "$pending" ]; then
      # Still healthy a little later? (catches containers that start and then crash-loop)
      sleep "$HEALTH_INTERVAL"
      [ -n "$(worker_restarting)" ] || { log "✓ health checks pass for $tag"; return 0; }
      pending=" $(worker_restarting)"
    fi
    [ "$(date +%s)" -ge "$deadline" ] && { log "✗ still unhealthy after ${HEALTH_TIMEOUT}s:$pending"; DC ps || true; DC logs --tail 30 ${pending} 2>/dev/null || true; return 1; }
    sleep "$HEALTH_INTERVAL"
  done
}

worker_restarting() { # names of this target's containers Docker is restarting right now
  local s id
  for s in "${SERVICES[@]}"; do
    id=$(DC ps -q "$s" 2>/dev/null) || continue
    [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Restarting}}' "$id" 2>/dev/null)" = true ] && printf '%s ' "$s"
  done
  return 0
}

record() { # TAG RESULT — history file + a metric for monitoring (DeployFailed alert)
  local ts; ts=$(date +%s)
  printf '%s\t%s\t%s\t%s\tfrom=%s\n' "$(date -u +%FT%TZ)" "$TARGET" "$1" "$2" "${CURRENT:-none}" >> "$STATE_DIR/history.log"
  [ -d "$TEXTFILE_DIR" ] || return 0
  local f="$TEXTFILE_DIR/brookrege_deploy_$TARGET.prom"
  local ok=0; [ "$2" = ok ] && ok=1
  local running; running=$(cat "$STATE_DIR/current-$TARGET" 2>/dev/null || echo "$1")
  {
    echo "# HELP brookrege_deploy_last_timestamp_seconds When the last deploy on this server finished."
    echo "# TYPE brookrege_deploy_last_timestamp_seconds gauge"
    echo "brookrege_deploy_last_timestamp_seconds{target=\"$TARGET\"} $ts"
    echo "# HELP brookrege_deploy_last_success 1 if the last deploy succeeded, 0 if it failed or was rolled back."
    echo "# TYPE brookrege_deploy_last_success gauge"
    echo "brookrege_deploy_last_success{target=\"$TARGET\",result=\"$2\"} $ok"
    echo "# HELP brookrege_deploy_info The release running on this server."
    echo "# TYPE brookrege_deploy_info gauge"
    echo "brookrege_deploy_info{target=\"$TARGET\",version=\"$running\"} 1"
  } > "$f.tmp" && mv "$f.tmp" "$f"
}

main "$@"
