#!/usr/bin/env bash
# Validates every Docker Compose file (schema, variables, YAML) with the example settings.
set -euo pipefail
cd "$(dirname "$0")/../.."
env=$(mktemp); trap 'rm -f "$env"' EXIT
{ cat .env.production.example .env.cluster.example .env.monitoring.example | grep -E '^[A-Z_]+='
  printf 'BACKUP_AGE_RECIPIENT=age1example\nMON_BIND=10.0.0.2\nSERVER_NAME=vps2\nLOKI_URL=http://10.0.0.1:3100/loki/api/v1/push\nCOMPOSE_PROFILES=postgres,nginx,redis\n'; } > "$env"
fail=0
for f in docker-compose.yml docker-compose.prod.yml docker-compose.cluster.yml infra/servers/vps*/docker-compose.yml infra/monitoring/docker-compose.yml infra/monitoring/agents/docker-compose.yml; do
  if out=$(docker compose -f "$f" --env-file "$env" config -q 2>&1); then echo "✓ $f"; else echo "✗ $f"; echo "$out" | sed 's/^/    /'; fail=1; fi
done
# Staging = production file + override, with the staging example settings.
senv=$(mktemp); trap 'rm -f "$env" "$senv"' EXIT
{ grep -E '^[A-Z_]+=' .env.staging.example; echo 'BACKUP_AGE_RECIPIENT=age1example'; } > "$senv"
if out=$(docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml --env-file "$senv" config -q 2>&1); then echo "✓ docker-compose.prod.yml + docker-compose.staging.yml"
else echo "✗ staging"; echo "$out" | sed 's/^/    /'; fail=1; fi
# The release image names deploy.sh relies on (registry/name:tag, web-staging on staging).
imgs=$(IMAGE_TAG=abcdef123456 docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml --env-file "$senv" config --images 2>/dev/null | sort -u | tr '\n' ' ')
case "$imgs" in *"/web-staging:abcdef123456"*) echo "✓ staging uses the web-staging release image" ;; *) echo "✗ unexpected staging images: $imgs"; fail=1 ;; esac
exit $fail
