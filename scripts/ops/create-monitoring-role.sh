#!/usr/bin/env bash
# Creates the read-only database role used by the monitoring exporter (idempotent), and enables
# pg_stat_statements (query statistics). Run ONCE on the PRIMARY; the replica receives it by replication.
#
#   bash scripts/ops/create-monitoring-role.sh                       # single server (docker-compose.prod.yml)
#   COMPOSE="docker compose -f infra/servers/vps1/docker-compose.yml --env-file .env.cluster" bash scripts/ops/create-monitoring-role.sh
#
# The password is taken from $SECRETS_DIR/pg_monitor_password (created with a random value if missing).
set -euo pipefail
cd "$(dirname "$0")/../.."
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml --env-file .env.production}"
SECRETS_DIR="${SECRETS_DIR:-/etc/brookrege/monitoring/secrets}"
PSQL="${PSQL:-$COMPOSE exec -T postgres sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\${POSTGRES_DB:-\$POSTGRES_USER}\"'}"

install -d -m 700 "$SECRETS_DIR"
f="$SECRETS_DIR/pg_monitor_password"
if [ ! -s "$f" ]; then
  (umask 077; openssl rand -hex 24 > "$f")
  echo "• generated $f"
fi
pw="$(tr -d '\n' < "$f")"
[[ "$pw" =~ ^[A-Za-z0-9]+$ ]] || { echo "✗ $f must contain letters and digits only"; exit 1; }

eval "$PSQL" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brookrege_monitor') THEN
    CREATE ROLE brookrege_monitor LOGIN PASSWORD '$pw' CONNECTION LIMIT 3;
  ELSE
    ALTER ROLE brookrege_monitor LOGIN PASSWORD '$pw' CONNECTION LIMIT 3;
  END IF;
END
\$\$;
GRANT pg_monitor TO brookrege_monitor;
ALTER ROLE brookrege_monitor SET statement_timeout = '5s';
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SQL
echo "✓ role brookrege_monitor ready (pg_monitor, 3 connections max, read-only statistics)"
