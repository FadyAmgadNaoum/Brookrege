#!/usr/bin/env bash
# Tests scripts/deploy/{deploy,rollback,deploy-cluster}.sh without servers: stand-in `docker`, `git`, `ssh` and
# `sudo` commands record what the scripts ask for and simulate failures (bad image, failed migration, nginx
# rejecting its configuration, unhealthy release…). Runs in CI (.github/workflows/ci.yml).
#   bash tests/deploy/test-deploy.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
fails=0; n=0
ok() { n=$((n+1)); echo "  ✓ $*"; }
bad() { n=$((n+1)); fails=$((fails+1)); echo "  ✗ $*"; }
check() { # DESCRIPTION CONDITION…
  local d="$1"; shift
  if "$@"; then ok "$d"; else bad "$d"; fi
}
has() { grep -qE "$1" "$2"; }
hasnt() { ! grep -qE "$1" "$2"; }

# ── stand-in commands ──
BIN="$WORK/bin"; mkdir -p "$BIN"
cat > "$BIN/docker" <<'SH'
#!/usr/bin/env bash
# Fake docker. State in $FAKE_DIR: running (tag of the running containers), calls.log.
F="$FAKE_DIR"; mkdir -p "$F"
bad_tag() { [[ " ${FAKE_BAD_TAGS:-} " == *" $(cat "$F/running" 2>/dev/null) "* ]]; }
if [ "$1" = compose ]; then
  shift; while [[ "${1:-}" == -f || "${1:-}" == --env-file ]]; do shift 2; done
  sub="$1"; shift
  echo "compose $sub $* [IMAGE_TAG=${IMAGE_TAG:-}]" >> "$F/calls.log"
  case "$sub" in
    config) exit "${FAKE_CONFIG_RC:-0}" ;;
    pull) exit "${FAKE_PULL_RC:-0}" ;;
    up) echo "$IMAGE_TAG" > "$F/running"; exit 0 ;;
    ps) [ "${1:-}" = -q ] && echo "cid-$2"; exit 0 ;;
    logs) exit 0 ;;
    run)
      if [[ " $* " == *" nginx -t "* ]]; then [ "${FAKE_NGINX_T_RC:-0}" = 0 ] || echo "nginx: [emerg] unknown directive" >&2; exit "${FAKE_NGINX_T_RC:-0}"; fi
      if [[ " $* " == *" migrate deploy "* ]]; then
        [ "${FAKE_MIGRATE_RC:-0}" = 0 ] || { echo "Error: P3009 migrate found failed migrations"; exit 1; }
        if [ "${FAKE_MIGRATIONS:-0}" = 1 ]; then printf 'The following migration(s) have been applied:\n\nmigrations/\n  └─ 20261001000000_new/\n'; else echo "No pending migrations to apply."; fi
        exit 0
      fi ;;
    exec)
      [ "$1" = -T ] && shift; svc="$1"
      case "$svc" in
        backup) exit "${FAKE_BACKUP_RC:-0}" ;;
        api) bad_tag && exit 1; echo "{\"status\":\"ok\",\"instance\":\"x\",\"version\":\"$(cat "$F/running")\",\"uptime\":3}"; exit 0 ;;
        *) bad_tag && exit 1; exit 0 ;;
      esac ;;
  esac
  exit 0
fi
echo "$*" >> "$F/calls.log"
case "$1" in
  inspect) if [[ "$*" == *Restarting* ]]; then echo false; elif bad_tag; then echo exited; else echo running; fi ;;
esac
exit 0
SH
cat > "$BIN/git" <<'SH'
#!/usr/bin/env bash
# Fake git: HEAD lives in $FAKE_DIR/head. Commits listed in FAKE_MISSING don't exist.
F="$FAKE_DIR"; mkdir -p "$F"
while [[ "${1:-}" == -c || "${1:-}" == -C ]]; do shift 2; done
sub="$1"; shift
echo "git $sub $*" >> "$F/calls.log"
case "$sub" in
  fetch) exit "${FAKE_FETCH_RC:-0}" ;;
  cat-file) c="${2%^\{commit\}}"; [[ " ${FAKE_MISSING:-} " == *" $c "* ]] && exit 128; exit 0 ;;
  rev-parse) a="${@: -1}"; if [ "$a" = HEAD ]; then cat "$F/head" 2>/dev/null || echo 000000000000; else a="${a%^\{commit\}}"; echo "${a:0:12}"; fi ;;
  checkout) echo "${@: -1}" > "$F/head" ;;
  diff) exit "${FAKE_NGINX_CHANGED:-0}" ;;
esac
exit 0
SH
cat > "$BIN/sudo" <<'SH'
#!/usr/bin/env bash
exec "$@"
SH
cat > "$BIN/ssh" <<'SH'
#!/usr/bin/env bash
# Fake ssh: runs the command "on" a host whose state lives in $SANDBOX/hosts/<host>.
while [[ "${1:-}" == -o ]]; do shift 2; done
host="${1#*@}"; shift
H="$SANDBOX/hosts/$host"; mkdir -p "$H"
[ "${FAKE_SSH_DOWN:-}" = "$host" ] && { echo "ssh: connect to host $host: timed out" >&2; exit 255; }
v="FAKE_BAD_TAGS_${host//./_}"
FAKE_DIR="$H/fake" BROOKREGE_STATE_DIR="$H/state" TEXTFILE_DIR="$H/textfile" FAKE_BAD_TAGS="${!v:-}" bash -c "$*"
SH
chmod +x "$BIN"/*

T1=aaaaaaaaaaaa; T2=bbbbbbbbbbbb; T3=cccccccccccc
# A fresh sandbox per test: the repository's deploy scripts + stand-in compose/settings files.
new_sandbox() {
  SB="$WORK/sb$RANDOM$RANDOM"; mkdir -p "$SB/scripts" "$SB/infra/servers/vps1" "$SB/infra/servers/vps2" "$SB/infra/servers/vps3" "$SB/state" "$SB/textfile" "$SB/fake"
  cp -r "$REPO/scripts/deploy" "$SB/scripts/"
  touch "$SB/docker-compose.prod.yml" "$SB/docker-compose.staging.yml" "$SB"/infra/servers/vps{1,2,3}/docker-compose.yml
  for f in .env.production .env.staging .env.cluster; do printf 'DB_USER=brookrege\nIMAGE_REGISTRY=ghcr.io/x/brookrege\n' > "$SB/$f"; chmod 600 "$SB/$f"; done
  export SANDBOX="$SB" BROOKREGE_ROOT="$SB" BROOKREGE_STATE_DIR="$SB/state" TEXTFILE_DIR="$SB/textfile" FAKE_DIR="$SB/fake"
  export PATH="$BIN:$PATH" HEALTH_TIMEOUT=2 HEALTH_INTERVAL=0.1 MIN_FREE_MB=1 DEPLOY_REMOTE_ROOT="$SB"
  unset FAKE_BAD_TAGS FAKE_PULL_RC FAKE_MIGRATE_RC FAKE_MIGRATIONS FAKE_NGINX_T_RC FAKE_BACKUP_RC FAKE_NGINX_CHANGED FAKE_MISSING FAKE_SSH_DOWN
  echo 999999999999 > "$SB/fake/head"
}
deploy() { "$SB/scripts/deploy/deploy.sh" "$@" > "$SB/out.log" 2>&1; echo $? > "$SB/rc"; }
rc() { cat "$SB/rc"; }
calls() { echo "$SB/fake/calls.log"; }
envtag() { grep '^IMAGE_TAG=' "$SB/.env.production" | cut -d= -f2; }
reset_calls() { : > "$SB/fake/calls.log"; }

echo "▸ Single server"
new_sandbox
deploy --target single --tag $T1
check "first deploy succeeds" [ "$(rc)" = 0 ]
check "records the running release" [ "$(cat "$SB/state/current-single")" = $T1 ]
check "writes IMAGE_TAG into the settings file" [ "$(envtag)" = $T1 ]
check "settings file keeps its permissions (600)" [ "$(stat -c %a "$SB/.env.production")" = 600 ]
check "steps in order: validate → nginx -t → pull → backup → migrate → switch" \
  bash -c "grep -oE 'compose (config|run --rm --no-deps -T nginx|pull|exec -T backup|run --rm --no-deps -T api|up -d --no-build api)' '$(calls)' | tr '\n' '|' | grep -q 'config|compose run --rm --no-deps -T nginx|compose pull|compose exec -T backup|compose run --rm --no-deps -T api|compose up -d --no-build api|'"
check "metric: last deploy succeeded" has 'brookrege_deploy_last_success\{target="single",result="ok"\} 1' "$SB/textfile/brookrege_deploy_single.prom"
check "metric: running version" has "brookrege_deploy_info\{target=\"single\",version=\"$T1\"\} 1" "$SB/textfile/brookrege_deploy_single.prom"

reset_calls; FAKE_MIGRATIONS=1 deploy --target single --tag $T2
check "upgrade with a migration succeeds" [ "$(rc)" = 0 ]
check "lists the applied migration" has '20261001000000_new' "$SB/out.log"
check "remembers the previous release" [ "$(cat "$SB/state/previous-single")" = $T1 ]
check "nginx not restarted when its configuration didn't change" hasnt 'force-recreate nginx' "$(calls)"

reset_calls; deploy --target single --tag $T2
check "same release again: nothing to do" bash -c "[ $(rc) = 0 ] && ! grep -q 'compose up' '$(calls)'"

reset_calls; FAKE_NGINX_CHANGED=1 deploy --target single --tag $T3 --force
check "changed nginx configuration → nginx recreated" has 'up -d --no-build --no-deps --force-recreate nginx' "$(calls)"

echo "▸ Failures before anything is switched"
for case in "nginx rejects the configuration:FAKE_NGINX_T_RC=1:nginx rejects" "image download fails:FAKE_PULL_RC=1:couldn't download" \
            "backup fails:FAKE_BACKUP_RC=1:backup failed" "migration fails:FAKE_MIGRATE_RC=1:migration failed" \
            "release not in the repository:FAKE_MISSING=$T2:isn't in the repository"; do
  IFS=: read -r name var msg <<< "$case"
  new_sandbox; deploy --target single --tag $T1; reset_calls
  env "$var" "$SB/scripts/deploy/deploy.sh" --target single --tag $T2 > "$SB/out.log" 2>&1; r=$?
  check "$name → stops (exit 1), says why" bash -c "[ $r = 1 ] && grep -q \"$msg\" '$SB/out.log'"
  check "$name → running containers untouched" bash -c "! grep -q 'compose up' '$(calls)' && [ \"\$(grep '^IMAGE_TAG=' '$SB/.env.production' | cut -d= -f2)\" = $T1 ] && [ \"\$(cat '$SB/state/current-single')\" = $T1 ]"
  [ "$var" != "FAKE_MISSING=$T2" ] && check "$name → code checkout restored" [ "$(cat "$SB/fake/head")" = $T1 ]
done
check "…and the failure is reported to monitoring" has 'result="failed"\} 0' "$SB/textfile/brookrege_deploy_single.prom"

echo "▸ Unhealthy release → automatic rollback"
new_sandbox; deploy --target single --tag $T1; reset_calls
FAKE_BAD_TAGS=$T2 FAKE_MIGRATIONS=1 deploy --target single --tag $T2
check "unhealthy release → exit 1" [ "$(rc)" = 1 ]
check "switched back to the previous release" bash -c "[ \"\$(cat '$SB/fake/running')\" = $T1 ] && [ \"\$(grep '^IMAGE_TAG=' '$SB/.env.production' | cut -d= -f2)\" = $T1 ]"
check "code checkout back on the previous release" [ "$(cat "$SB/fake/head")" = $T1 ]
check "running release still recorded as the previous one" [ "$(cat "$SB/state/current-single")" = $T1 ]
check "history says rolled_back" has "single	$T2	rolled_back" "$SB/state/history.log"
check "warns that the migration stays in the database" has 'database keeps the new migrations' "$SB/out.log"
check "metric: last deploy failed" has 'result="rolled_back"\} 0' "$SB/textfile/brookrege_deploy_single.prom"

new_sandbox; deploy --target single --tag $T1
FAKE_BAD_TAGS="$T1 $T2" deploy --target single --tag $T2
check "rollback also unhealthy → exit 2 and says so" bash -c "[ $(rc) = 2 ] && grep -q 'ALSO unhealthy' '$SB/out.log'"

new_sandbox; FAKE_BAD_TAGS=$T1 deploy --target single --tag $T1
check "first ever deploy unhealthy → exit 1, explains there's nothing to go back to" bash -c "[ $(rc) = 1 ] && grep -q 'no previous release' '$SB/out.log'"

new_sandbox; deploy --target single --tag $T1; FAKE_BAD_TAGS=$T2 deploy --target single --tag $T2 --no-rollback
check "--no-rollback leaves the failed release running" bash -c "[ $(rc) = 1 ] && [ \"\$(cat '$SB/fake/running')\" = $T2 ]"

echo "▸ Manual rollback"
new_sandbox; deploy --target single --tag $T1; deploy --target single --tag $T2; reset_calls
"$SB/scripts/deploy/rollback.sh" --target single > "$SB/out.log" 2>&1; r=$?
check "rollback.sh returns to the previous release" bash -c "[ $r = 0 ] && [ \"\$(cat '$SB/state/current-single')\" = $T1 ] && [ \"\$(cat '$SB/fake/running')\" = $T1 ]"
check "rollback takes no backup and runs no migrations" bash -c "! grep -qE 'exec -T backup|migrate deploy' '$(calls)'"
new_sandbox; "$SB/scripts/deploy/rollback.sh" --target single > "$SB/out.log" 2>&1; r=$?
check "rollback with no history → clear message" bash -c "[ $r = 1 ] && grep -q 'no previous release' '$SB/out.log'"

echo "▸ Targets"
new_sandbox; deploy --target vps3 --tag $T1 --skip-backup --no-migrate
check "vps3: app servers incl. worker, no backup, no migration" bash -c "[ $(rc) = 0 ] && grep -q 'up -d --no-build api worker web admin' '$(calls)' && ! grep -qE 'exec -T backup|migrate deploy' '$(calls)'"
new_sandbox; deploy --target vps2 --tag $T1
check "vps2: migrations run, no backup (no database here), no nginx" bash -c "grep -q 'migrate deploy' '$(calls)' && ! grep -qE 'exec -T backup|nginx' '$(calls)'"
new_sandbox; deploy --target vps1 --tag $T1
check "vps1: backup + pgBouncer/backup images + nginx check, no app, no migration" bash -c "grep -q 'up -d --no-build pgbouncer backup' '$(calls)' && grep -q 'exec -T backup' '$(calls)' && grep -q 'nginx nginx -t' '$(calls)' && ! grep -q 'migrate deploy' '$(calls)'"
new_sandbox; deploy --target staging --tag $T1
check "staging: its own settings file" bash -c "[ $(rc) = 0 ] && grep -q '^IMAGE_TAG=$T1' '$SB/.env.staging'"
new_sandbox; deploy --target single --tag 'main; rm -rf /'
check "rejects a release that isn't a commit id" [ "$(rc)" = 64 ]
new_sandbox; deploy --target moon --tag $T1
check "rejects an unknown target" [ "$(rc)" = 64 ]

echo "▸ Three servers (deploy-cluster.sh on VPS1)"
cluster() { SUDO="" "$SB/scripts/deploy/deploy-cluster.sh" "$@" > "$SB/out.log" 2>&1; echo $? > "$SB/rc"; }
h() { cat "$SB/hosts/$1/state/current-$2" 2>/dev/null || cat "$SB/state/current-$2" 2>/dev/null; }
new_sandbox; export DEPLOY_VPS2=deploy@10.0.0.2 DEPLOY_VPS3=deploy@10.0.0.3
cluster $T1
check "cluster deploy succeeds" [ "$(rc)" = 0 ]
check "all three servers run the release" bash -c "[ '$(h 10.0.0.2 vps2)' = $T1 ] && [ '$(h 10.0.0.3 vps3)' = $T1 ] && [ \"\$(cat '$SB/state/current-vps1')\" = $T1 ]"
check "migrations only on VPS2" bash -c "grep -q 'migrate deploy' '$SB/hosts/10.0.0.2/fake/calls.log' && ! grep -q 'migrate deploy' '$SB/hosts/10.0.0.3/fake/calls.log'"
check "backup only on VPS1" bash -c "grep -q 'exec -T backup' '$(calls)' && ! grep -q 'exec -T backup' '$SB/hosts/10.0.0.2/fake/calls.log'"
check "order: VPS1, then VPS2, then VPS3" bash -c "grep -oE '[0-9]/3 VPS[0-9]' '$SB/out.log' | tr '\n' ' ' | grep -q '1/3 VPS1 2/3 VPS2 3/3 VPS3'"

FAKE_BAD_TAGS_10_0_0_3=$T2 cluster $T2
check "VPS3 unhealthy → cluster deploy fails" [ "$(rc)" = 1 ]
check "…and every server is back on the previous release" bash -c "[ '$(h 10.0.0.2 vps2)' = $T1 ] && [ '$(h 10.0.0.3 vps3)' = $T1 ] && [ \"\$(cat '$SB/state/current-vps1')\" = $T1 ]"

cluster $T2; cluster --rollback
check "cluster --rollback puts all three back" bash -c "[ $(rc) = 0 ] && [ '$(h 10.0.0.2 vps2)' = $T1 ] && [ '$(h 10.0.0.3 vps3)' = $T1 ] && [ \"\$(cat '$SB/state/current-vps1')\" = $T1 ]"

new_sandbox; FAKE_SSH_DOWN=10.0.0.3 cluster $T1
check "a server unreachable → nothing changed anywhere" bash -c "[ $(rc) = 1 ] && [ ! -f '$SB/state/current-vps1' ] && ! grep -q 'compose up' '$(calls)' 2>/dev/null"

echo
[ "$fails" = 0 ] && echo "✓ deploy scripts: all $n checks pass" || { echo "✗ deploy scripts: $fails of $n checks failed"; exit 1; }
